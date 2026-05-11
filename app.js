/**
 * App Web de Asistencia con ArUco + Google Sheets
 * 
 * Flujo:
 * 1. Login con Google (OAuth2)
 * 2. Seleccionar turno (mañana/tarde)
 * 3. Seleccionar nivel (hoja del spreadsheet)
 * 4. Seleccionar curso
 * 5. Escanear códigos ArUco
 * 6. Enviar asistencia a Google Sheets
 */

// ============================================
// CONFIGURACIÓN
// ============================================
const DETECT_INTERVAL_MS = 200;
const MAX_NUM_LISTA = 55;

// ============================================
// ESTADO GLOBAL
// ============================================
const estado = {
    turno: null,           // 'manana' | 'tarde'
    nivel: null,           // nombre de la hoja (ej: '6°')
    curso: null,           // ej: '6A'
    alumnos: [],           // { numLista, run, nombre, rowIndex }
    asistencia: new Set(), // numLista de presentes en esta sesión
    fechaObjetivo: null,   // YYYY-MM-DD
    columnaFecha: null,    // { column, colIndex }
    niveles: [],           // lista de nombres de hojas
    cursos: [],            // lista de cursos en el nivel
    rawSheetData: [],      // datos brutos de la hoja
    dateMap: {},           // mapa fecha→columna
    enviando: false
};

// ============================================
// REFERENCIAS DOM
// ============================================
let videoStream = null;
let videoTrack = null;
let detector = null;
let processCanvas = null;
let processCtx = null;
let isScanning = false;
let lastDetectTime = 0;
let zoomCapabilities = null;
let currentZoom = 1;

const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas?.getContext('2d');

// Referencias a pantallas
const screens = {
    login: document.getElementById('login-screen'),
    turno: document.getElementById('turno-screen'),
    nivel: document.getElementById('nivel-screen'),
    scanner: document.getElementById('scanner-screen')
};

// Referencias a elementos
const elVideo = document.getElementById('video');
const elCounter = document.getElementById('counter');
const elLastDetected = document.getElementById('last-detected');
const elAttendanceList = document.getElementById('attendance-list');
const elSidePanel = document.getElementById('side-panel');
const elBtnToggleList = document.getElementById('btn-toggle-list');
const elBtnClear = document.getElementById('btn-clear');
const elBtnEnviar = document.getElementById('btn-enviar');
const elZoomSlider = document.getElementById('zoom-slider');
const elZoomValue = document.getElementById('zoom-value');
const elZoomIn = document.getElementById('zoom-in');
const elZoomOut = document.getElementById('zoom-out');
const elFlash = document.getElementById('flash');
const elCursoActivo = document.getElementById('curso-activo');
const elFechaIndicador = document.getElementById('fecha-indicador');
const elModalConfirm = document.getElementById('modal-confirm');
const elModalBody = document.getElementById('modal-body');
const elBtnConfirmSend = document.getElementById('btn-confirm-send');
const elBtnCancelSend = document.getElementById('btn-cancel-send');

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Verificar librería ArUco
    if (typeof AR === 'undefined' || typeof AR.Detector === 'undefined') {
        showErrorGlobal('Error: No se pudo cargar la librería de detección ArUco.');
        return;
    }
    detector = new AR.Detector({ dictionaryName: 'ARUCO' });

    processCanvas = document.getElementById('process-canvas');
    processCtx = processCanvas.getContext('2d', { willReadFrequently: true });

    // Inicializar auth
    const authResult = await window.Auth.initAuth();

    if (authResult.success && window.Auth.isAuthenticated()) {
        mostrarPantalla('turno');
    } else {
        mostrarPantalla('login');
    }

    // Configurar callback para cuando el login sea exitoso
    window.Auth.setLoginSuccessCallback(() => {
        mostrarPantalla('turno');
    });

    // Renderizar botón de login
    window.Auth.renderLoginButton('login-button-container');

    // Event listeners
    setupEventListeners();
});

function setupEventListeners() {
    // Botones de turno
    document.getElementById('btn-manana')?.addEventListener('click', () => seleccionarTurno('manana'));
    document.getElementById('btn-tarde')?.addEventListener('click', () => seleccionarTurno('tarde'));

    // Botón volver en turno
    document.getElementById('btn-volver-turno')?.addEventListener('click', () => {
        window.Auth.signOut();
    });

    // Selectores de nivel y curso
    document.getElementById('nivel-select')?.addEventListener('change', onNivelChange);
    document.getElementById('curso-select')?.addEventListener('change', onCursoChange);
    document.getElementById('btn-iniciar-scanner')?.addEventListener('click', iniciarScanner);
    document.getElementById('btn-volver-nivel')?.addEventListener('click', () => mostrarPantalla('turno'));

    // Scanner
    elBtnToggleList?.addEventListener('click', toggleList);
    elBtnClear?.addEventListener('click', clearAttendance);
    elBtnEnviar?.addEventListener('click', mostrarConfirmacion);
    elZoomSlider?.addEventListener('input', onZoomSlider);
    elZoomIn?.addEventListener('click', () => adjustZoom(0.5));
    elZoomOut?.addEventListener('click', () => adjustZoom(-0.5));

    // Modal
    elBtnConfirmSend?.addEventListener('click', confirmarEnvio);
    elBtnCancelSend?.addEventListener('click', cerrarModal);

    // Cerrar panel lateral al tocar fuera
    document.addEventListener('click', (e) => {
        if (elSidePanel?.classList.contains('open') &&
            !elSidePanel.contains(e.target) &&
            e.target !== elBtnToggleList) {
            elSidePanel.classList.remove('open');
        }
    });
}

// ============================================
// NAVEGACIÓN ENTRE PANTALLAS
// ============================================

function mostrarPantalla(nombre) {
    Object.values(screens).forEach(s => s?.classList.remove('active'));
    screens[nombre]?.classList.add('active');
}

function showErrorGlobal(msg) {
    const el = document.getElementById('global-error');
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
    } else {
        alert(msg);
    }
}

function hideErrorGlobal() {
    document.getElementById('global-error')?.classList.add('hidden');
}

// ============================================
// SELECCIÓN DE TURNO
// ============================================

async function seleccionarTurno(turno) {
    estado.turno = turno;
    hideErrorGlobal();

    const loading = document.getElementById('turno-loading');
    if (loading) loading.classList.remove('hidden');

    try {
        estado.niveles = await window.Sheets.getNiveles(turno);
        if (estado.niveles.length === 0) {
            throw new Error('No se encontraron hojas en el documento');
        }
        buildNivelSelector();
        mostrarPantalla('nivel');
    } catch (err) {
        console.error('Error cargando niveles:', err);
        showErrorGlobal('Error cargando niveles: ' + err.message);
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

// ============================================
// SELECCIÓN DE NIVEL Y CURSO
// ============================================

function buildNivelSelector() {
    const select = document.getElementById('nivel-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecciona nivel --</option>' +
        estado.niveles.map(n => `<option value="${n}">${n}</option>`).join('');

    // Limpiar curso
    const cursoSelect = document.getElementById('curso-select');
    if (cursoSelect) {
        cursoSelect.innerHTML = '<option value="">-- Primero selecciona nivel --</option>';
        cursoSelect.disabled = true;
    }
    document.getElementById('btn-iniciar-scanner')?.classList.add('hidden');
}

async function onNivelChange(e) {
    const nivel = e.target.value;
    estado.nivel = nivel || null;
    estado.curso = null;
    estado.cursos = [];

    const cursoSelect = document.getElementById('curso-select');
    const btnIniciar = document.getElementById('btn-iniciar-scanner');

    if (!nivel) {
        if (cursoSelect) {
            cursoSelect.innerHTML = '<option value="">-- Primero selecciona nivel --</option>';
            cursoSelect.disabled = true;
        }
        btnIniciar?.classList.add('hidden');
        return;
    }

    const loading = document.getElementById('nivel-loading');
    if (loading) loading.classList.remove('hidden');

    try {
        const data = await window.Sheets.getSheetData(estado.turno, nivel);
        estado.rawSheetData = data.values || [];
        const procesado = window.Sheets.procesarDatosHoja(estado.rawSheetData);
        estado.cursos = procesado.cursos;
        estado.alumnosPorCurso = procesado.alumnosPorCurso;

        // Construir selector de curso
        if (cursoSelect) {
            cursoSelect.innerHTML = '<option value="">-- Selecciona curso --</option>' +
                estado.cursos.map(c => `<option value="${c}">${c}</option>`).join('');
            cursoSelect.disabled = false;
        }

        // Construir mapa de fechas
        estado.dateMap = window.DateMapper.construirMapaFechas(estado.rawSheetData);
        const fechasDisp = window.DateMapper.getFechasDisponibles(estado.dateMap);
        console.log('Fechas disponibles:', fechasDisp.length, 'primera:', fechasDisp[0], 'última:', fechasDisp[fechasDisp.length - 1]);

    } catch (err) {
        console.error('Error cargando datos del nivel:', err);
        showErrorGlobal('Error cargando datos: ' + err.message);
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function onCursoChange(e) {
    const curso = e.target.value;
    estado.curso = curso || null;

    const btnIniciar = document.getElementById('btn-iniciar-scanner');
    if (curso) {
        btnIniciar?.classList.remove('hidden');
    } else {
        btnIniciar?.classList.add('hidden');
    }
}

// ============================================
// INICIAR SCANNER
// ============================================

async function iniciarScanner() {
    if (!estado.curso) return;

    // Cargar alumnos del curso
    estado.alumnos = estado.alumnosPorCurso[estado.curso] || [];
    if (estado.alumnos.length === 0) {
        showErrorGlobal('No se encontraron alumnos para el curso ' + estado.curso);
        return;
    }

    // Determinar fecha objetivo
    const colHoy = window.DateMapper.getColumnaHoy(estado.dateMap);
    if (colHoy) {
        estado.fechaObjetivo = new Date().toISOString().split('T')[0];
        estado.columnaFecha = colHoy;
    } else {
        // Fecha actual no está en la hoja, mostrar selector
        const fechas = window.DateMapper.getFechasDisponibles(estado.dateMap);
        if (fechas.length === 0) {
            showErrorGlobal('No se encontraron fechas en la hoja de asistencia');
            return;
        }
        // Elegir la última fecha disponible (más reciente)
        estado.fechaObjetivo = fechas[fechas.length - 1];
        estado.columnaFecha = estado.dateMap[estado.fechaObjetivo];
        // Mostrar advertencia
        console.warn('Fecha actual no encontrada, usando:', estado.fechaObjetivo);
    }

    // Mostrar info en UI
    elCursoActivo.textContent = estado.curso;
    if (elFechaIndicador) {
        const fechaFormateada = window.DateMapper.formatearFecha(estado.fechaObjetivo);
        elFechaIndicador.textContent = `Fecha: ${fechaFormateada}`;
        elFechaIndicador.classList.remove('hidden');
    }

    // Iniciar cámara
    await startCamera();
}

// ============================================
// CÁMARA
// ============================================

async function startCamera() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoTrack = videoStream.getVideoTracks()[0];
        elVideo.srcObject = videoStream;

        await new Promise((resolve) => {
            elVideo.onloadedmetadata = () => {
                elVideo.play();
                resolve();
            };
        });

        detectZoomCapabilities();

        // Reset asistencia
        estado.asistencia.clear();
        elAttendanceList.innerHTML = '';
        elCounter.textContent = '0';
        elLastDetected.textContent = 'Esperando...';

        mostrarPantalla('scanner');
        isScanning = true;
        requestAnimationFrame(detectionLoop);

    } catch (err) {
        console.error('Error al iniciar cámara:', err);
        let msg = 'No se pudo acceder a la cámara.';
        if (err.name === 'NotAllowedError') msg = 'Permiso de cámara denegado.';
        else if (err.name === 'NotFoundError') msg = 'No se encontró una cámara disponible.';
        else if (err.name === 'NotReadableError') msg = 'La cámara está siendo usada por otra aplicación.';
        showErrorGlobal(msg);
    }
}

function detectionLoop() {
    if (!isScanning) return;
    const now = Date.now();
    if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
        lastDetectTime = now;
        processFrame();
    }
    requestAnimationFrame(detectionLoop);
}

function processFrame() {
    if (elVideo.readyState !== elVideo.HAVE_ENOUGH_DATA) return;

    if (processCanvas.width !== elVideo.videoWidth || processCanvas.width === 0) {
        processCanvas.width = elVideo.videoWidth;
        processCanvas.height = elVideo.videoHeight;
        if (overlayCanvas) {
            overlayCanvas.width = elVideo.videoWidth;
            overlayCanvas.height = elVideo.videoHeight;
        }
    }

    if (processCanvas.width === 0) return;

    processCtx.drawImage(elVideo, 0, 0, processCanvas.width, processCanvas.height);
    const imageData = processCtx.getImageData(0, 0, processCanvas.width, processCanvas.height);

    if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    try {
        const markers = detector.detect(imageData);
        if (markers && markers.length > 0) {
            markers.forEach(marker => {
                handleMarkerDetected(marker.id);
                if (overlayCtx) {
                    drawGreenBox(marker.corners);
                }
            });
        }
    } catch (e) {
        // Silenciar errores de lectura
    }
}

function drawGreenBox(corners) {
    overlayCtx.lineWidth = 6;
    overlayCtx.strokeStyle = '#3fb950';
    overlayCtx.beginPath();
    overlayCtx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
        overlayCtx.lineTo(corners[i].x, corners[i].y);
    }
    overlayCtx.closePath();
    overlayCtx.stroke();
}

// ============================================
// MANEJO DE MARKER DETECTADO
// ============================================

function handleMarkerDetected(markerId) {
    if (markerId < 1 || markerId > MAX_NUM_LISTA) return;

    const numLista = markerId;

    // Buscar alumno en la lista cargada
    const alumno = estado.alumnos.find(a => a.numLista === numLista);
    if (!alumno) {
        console.log(`N° ${numLista} no pertenece al curso ${estado.curso}`);
        return;
    }

    // Anti-duplicados
    if (estado.asistencia.has(numLista)) return;

    estado.asistencia.add(numLista);

    const entry = {
        numLista: numLista,
        run: alumno.run,
        nombre: alumno.nombre,
        curso: estado.curso,
        timestamp: Date.now()
    };

    updateCounter();
    updateLastDetected(entry);
    addToList(entry);
    flashScreen();

    console.log(`Lista ${numLista} → ${alumno.nombre}`);
}

// ============================================
// UI - ACTUALIZACIONES
// ============================================

function updateCounter() {
    elCounter.textContent = estado.asistencia.size;
}

function updateLastDetected(entry) {
    const text = `N°${entry.numLista}: ${entry.nombre}`;
    elLastDetected.textContent = text;
    elLastDetected.classList.add('detected');
    setTimeout(() => elLastDetected.classList.remove('detected'), 1000);
}

function addToList(entry) {
    const li = document.createElement('li');
    const timeStr = new Date(entry.timestamp).toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    li.innerHTML = `
        <div class="estudiante-info">
            <span class="num-lista">N° ${entry.numLista}</span>
            <span class="rut">${entry.nombre}</span>
        </div>
        <span class="time">${timeStr}</span>
    `;
    elAttendanceList.insertBefore(li, elAttendanceList.firstChild);
}

function flashScreen() {
    elFlash?.classList.add('active');
    setTimeout(() => elFlash?.classList.remove('active'), 150);
}

function toggleList() {
    elSidePanel?.classList.toggle('open');
}

function clearAttendance() {
    if (!confirm('¿Limpiar toda la lista de asistencia?')) return;
    estado.asistencia.clear();
    elAttendanceList.innerHTML = '';
    elCounter.textContent = '0';
    elLastDetected.textContent = 'Esperando...';
}

// ============================================
// ZOOM
// ============================================

function detectZoomCapabilities() {
    if (!videoTrack) return;
    try {
        zoomCapabilities = videoTrack.getCapabilities();
        if (zoomCapabilities?.zoom) {
            const min = zoomCapabilities.zoom.min || 1;
            const max = zoomCapabilities.zoom.max || 10;
            const step = zoomCapabilities.zoom.step || 0.1;
            elZoomSlider.min = min;
            elZoomSlider.max = max;
            elZoomSlider.step = step;
            elZoomSlider.value = min;
            currentZoom = min;
        } else {
            document.getElementById('zoom-panel')?.classList.add('hidden');
        }
    } catch (e) {
        console.log('No se pudieron obtener capacidades de zoom');
    }
}

function onZoomSlider(e) {
    applyZoom(parseFloat(e.target.value));
}

function adjustZoom(delta) {
    if (!zoomCapabilities?.zoom) return;
    const newZoom = Math.max(
        zoomCapabilities.zoom.min,
        Math.min(zoomCapabilities.zoom.max, currentZoom + delta)
    );
    applyZoom(newZoom);
    elZoomSlider.value = newZoom;
}

async function applyZoom(value) {
    if (!videoTrack) return;
    try {
        await videoTrack.applyConstraints({ advanced: [{ zoom: value }] });
        currentZoom = value;
        elZoomValue.textContent = value.toFixed(1) + 'x';
    } catch (e) {
        console.error('Error aplicando zoom:', e);
    }
}

// ============================================
// ENVÍO DE ASISTENCIA A GOOGLE SHEETS
// ============================================

function mostrarConfirmacion() {
    if (estado.asistencia.size === 0) {
        alert('No hay alumnos registrados para enviar.');
        return;
    }
    if (estado.enviando) return;

    const fechaStr = window.DateMapper.formatearFecha(estado.fechaObjetivo);
    const listaNombres = Array.from(estado.asistencia)
        .sort((a, b) => a - b)
        .map(num => {
            const al = estado.alumnos.find(a => a.numLista === num);
            return `N°${num}: ${al ? al.nombre : '?'}`;
        })
        .join('\n');

    elModalBody.innerHTML = `
        <p><strong>Turno:</strong> ${estado.turno === 'manana' ? 'Mañana' : 'Tarde'}</p>
        <p><strong>Curso:</strong> ${estado.curso}</p>
        <p><strong>Fecha:</strong> ${fechaStr}</p>
        <p><strong>Presentes:</strong> ${estado.asistencia.size}</p>
        <hr>
        <pre class="lista-confirmacion">${listaNombres}</pre>
    `;

    elModalConfirm?.classList.add('active');
}

function cerrarModal() {
    elModalConfirm?.classList.remove('active');
}

async function confirmarEnvio() {
    if (estado.enviando) return;
    estado.enviando = true;
    elBtnConfirmSend.textContent = 'Enviando...';
    elBtnConfirmSend.disabled = true;

    try {
        const updates = [];
        const sheetName = estado.nivel;
        const col = estado.columnaFecha.column;

        // Para cada alumno presente, preparar la celda
        for (const numLista of estado.asistencia) {
            const alumno = estado.alumnos.find(a => a.numLista === numLista);
            if (!alumno) continue;

            const range = `${sheetName}!${col}${alumno.rowIndex}`;
            updates.push({
                range: range,
                values: [['P']]
            });
        }

        if (updates.length === 0) {
            throw new Error('No hay alumnos para enviar');
        }

        const result = await window.Sheets.batchUpdateValues(estado.turno, updates);
        console.log('Asistencia enviada:', result);

        alert(`✅ Asistencia enviada correctamente.\n${updates.length} alumnos marcados con P.`);

        // Limpiar asistencia local
        estado.asistencia.clear();
        elAttendanceList.innerHTML = '';
        elCounter.textContent = '0';
        elLastDetected.textContent = 'Esperando...';

        cerrarModal();

        // Volver a la pantalla de selección
        stopCamera();
        mostrarPantalla('nivel');

    } catch (err) {
        console.error('Error enviando asistencia:', err);
        if (err.message === 'TOKEN_EXPIRED') {
            alert('⚠️ Sesión expirada. Por favor vuelve a iniciar sesión.');
            window.Auth.signOut();
        } else {
            alert('❌ Error al enviar: ' + err.message);
        }
    } finally {
        estado.enviando = false;
        elBtnConfirmSend.textContent = 'Confirmar y Enviar';
        elBtnConfirmSend.disabled = false;
    }
}

function stopCamera() {
    isScanning = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
        videoTrack = null;
    }
}

// ============================================
// LIMPIEZA
// ============================================

window.addEventListener('beforeunload', () => {
    stopCamera();
});

// Botón volver desde scanner
window.volverANivel = function() {
    stopCamera();
    mostrarPantalla('nivel');
};
