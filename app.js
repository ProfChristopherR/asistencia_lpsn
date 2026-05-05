/**
 * App Web de Asistencia con ArUco - Metodo "Numero de Lista"
 * 
 * Arquitectura:
 * - Solo 55 codigos ArUco (IDs 1-55) pegados en los bancos
 * - El profesor selecciona el curso ANTES de escanear
 * - La app cruza: markerId (numero de lista) + curso seleccionado = alumno unico
 * 
 * Esto permite cubrir 2,500+ alumnos con solo 55 codigos fisicos.
 */

// ============================================
// BASE DE DATOS LOCAL (DEMO)
// ============================================
// En produccion, esto vendria de una API o JSON externo
const CURSOS = [
    { code: "3MB", nombre: "3ro Medio B" },
    { code: "4MA", nombre: "4to Medio A" },
    { code: "2MC", nombre: "2do Medio C" }
];

// Mapa de alumnos por curso: cursoCode -> { numLista -> alumno }
const ALUMNOS_DB = {
    "3MB": {
        1: { rut: "12.345.601-K", nombre: "Ana Garcia" },
        2: { rut: "12.345.602-K", nombre: "Benito Lopez" },
        3: { rut: "12.345.603-K", nombre: "Carla Mendez" },
        4: { rut: "12.345.604-K", nombre: "Diego Torres" },
        5: { rut: "12.345.605-K", nombre: "Elena Ruiz" },
        6: { rut: "12.345.606-K", nombre: "Felipe Soto" },
        7: { rut: "12.345.607-K", nombre: "Gabriela Diaz" },
        8: { rut: "12.345.608-K", nombre: "Hugo Martinez" },
        9: { rut: "12.345.609-K", nombre: "Isabel Castro" },
        10: { rut: "12.345.610-K", nombre: "Juan Perez" },
        11: { rut: "12.345.611-K", nombre: "Laura Vargas" },
        12: { rut: "12.345.612-K", nombre: "Mario Silva" },
        13: { rut: "12.345.613-K", nombre: "Natalia Rojas" },
        14: { rut: "12.345.614-K", nombre: "Oscar Fuentes" },
        15: { rut: "12.345.615-K", nombre: "Patricia Morales" }
    },
    "4MA": {
        1: { rut: "13.456.701-K", nombre: "Alberto Nunez" },
        2: { rut: "13.456.702-K", nombre: "Beatriz Ortega" },
        3: { rut: "13.456.703-K", nombre: "Cesar Herrera" },
        4: { rut: "13.456.704-K", nombre: "Diana Ibarra" },
        5: { rut: "13.456.705-K", nombre: "Esteban Bravo" }
    },
    "2MC": {
        1: { rut: "11.234.501-K", nombre: "Fernanda Arias" },
        2: { rut: "11.234.502-K", nombre: "Gustavo Paredes" },
        3: { rut: "11.234.503-K", nombre: "Helena Campos" },
        4: { rut: "11.234.504-K", nombre: "Ignacio Reyes" },
        5: { rut: "11.234.505-K", nombre: "Julia Figueroa" }
    }
};

// ============================================
// CONFIGURACION
// ============================================
const DETECT_INTERVAL_MS = 200;
//const PROCESS_WIDTH = 640;
const MAX_NUM_LISTA = 55; // Maximo numero de lista (bancos en el aula)

// ============================================
// ESTADO
// ============================================
let videoStream = null;
let videoTrack = null;
let detector = null;
let processCanvas = null;
let processCtx = null;
let isScanning = false;
let lastDetectTime = 0;

let cursoSeleccionado = null; // Codigo del curso actual (ej: "3MB")
let asistenciaActual = new Set(); // Set de "numLista" ya registrados en esta sesion

let zoomCapabilities = null;
let currentZoom = 1;

// ============================================
// ELEMENTOS DOM
// ============================================
const elStartScreen = document.getElementById('start-screen');
const elScannerScreen = document.getElementById('scanner-screen');
const elBtnStart = document.getElementById('btn-start');
const elErrorMsg = document.getElementById('error-msg');
const elVideo = document.getElementById('video');
const elCounter = document.getElementById('counter');
const elLastDetected = document.getElementById('last-detected');
const elAttendanceList = document.getElementById('attendance-list');
const elSidePanel = document.getElementById('side-panel');
const elBtnToggleList = document.getElementById('btn-toggle-list');
const elBtnClear = document.getElementById('btn-clear');
const elZoomSlider = document.getElementById('zoom-slider');
const elZoomValue = document.getElementById('zoom-value');
const elZoomIn = document.getElementById('zoom-in');
const elZoomOut = document.getElementById('zoom-out');
const elFlash = document.getElementById('flash');

// ============================================
// INICIALIZACION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof AR === 'undefined' || typeof AR.Detector === 'undefined') {
        showError('Error: No se pudo cargar la libreria de deteccion ArUco. Verifica tu conexion a internet.');
        elBtnStart.disabled = true;
        return;
    }

    // Crear detector con diccionario ARUCO (DICT_ARUCO_ORIGINAL de OpenCV)
    detector = new AR.Detector({ dictionaryName: 'ARUCO' });

    processCanvas = document.getElementById('process-canvas');
    processCtx = processCanvas.getContext('2d', { willReadFrequently: true });

    // Construir selector de curso
    buildCursoSelector();

    // Event listeners
    elBtnStart.addEventListener('click', startCamera);
    elBtnToggleList.addEventListener('click', toggleList);
    elBtnClear.addEventListener('click', clearAttendance);
    elZoomSlider.addEventListener('input', onZoomSlider);
    elZoomIn.addEventListener('click', () => adjustZoom(0.5));
    elZoomOut.addEventListener('click', () => adjustZoom(-0.5));

    document.addEventListener('click', (e) => {
        if (elSidePanel.classList.contains('open') &&
            !elSidePanel.contains(e.target) &&
            e.target !== elBtnToggleList) {
            elSidePanel.classList.remove('open');
        }
    });
});

// ============================================
// SELECTOR DE CURSO
// ============================================

function buildCursoSelector() {
    const container = document.createElement('div');
    container.className = 'curso-selector';
    container.innerHTML = `
        <label for="curso-select">Selecciona el curso:</label>
        <select id="curso-select">
            <option value="">-- Elige un curso --</option>
            ${CURSOS.map(c => `<option value="${c.code}">${c.nombre}</option>`).join('')}
        </select>
    `;

    // Insertar antes del boton de inicio
    const startContent = document.querySelector('.start-content');
    startContent.insertBefore(container, elBtnStart);

    // Listener para cambio de curso
    document.getElementById('curso-select').addEventListener('change', (e) => {
        cursoSeleccionado = e.target.value;
        if (cursoSeleccionado) {
            console.log('Curso seleccionado:', cursoSeleccionado);
        }
    });
}

// ============================================
// CÁMARA
// ============================================

async function startCamera() {
    // Validar que se haya seleccionado un curso
    if (!cursoSeleccionado) {
        showError('Por favor selecciona un curso antes de iniciar la camara.');
        return;
    }

    elBtnStart.disabled = true;
    elBtnStart.textContent = 'Iniciando...';

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

        // const aspect = elVideo.videoHeight / elVideo.videoWidth;
        //processCanvas.width = PROCESS_WIDTH;
        //processCanvas.height = Math.round(PROCESS_WIDTH * aspect);

        detectZoomCapabilities();

        // Mostrar curso seleccionado en el panel superior
        const cursoNombre = CURSOS.find(c => c.code === cursoSeleccionado)?.nombre || cursoSeleccionado;
        document.getElementById('curso-activo').textContent = cursoNombre;

        elStartScreen.classList.remove('active');
        elScannerScreen.classList.add('active');

        isScanning = true;
        requestAnimationFrame(detectionLoop);

        console.log('Camara iniciada. Curso:', cursoSeleccionado);

    } catch (err) {
        console.error('Error al iniciar camara:', err);
        let msg = 'No se pudo acceder a la camara.';
        if (err.name === 'NotAllowedError') {
            msg = 'Permiso de camara denegado.';
        } else if (err.name === 'NotFoundError') {
            msg = 'No se encontro una camara disponible.';
        } else if (err.name === 'NotReadableError') {
            msg = 'La camara esta siendo usada por otra aplicacion.';
        }
        showError(msg);
        elBtnStart.disabled = false;
        elBtnStart.textContent = 'Iniciar Camara';
    }
}

// ============================================
// LOOP DE DETECCION
// ============================================

function detectionLoop() {
    if (!isScanning) return;

    const now = Date.now();
    if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
        lastDetectTime = now;
        processFrame();
    }
    requestAnimationFrame(detectionLoop);
}

// Referencias a los canvas al inicio de tu archivo (asegúrate de agregar la del overlay)
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas?.getContext('2d');

function processFrame() {
    if (elVideo.readyState !== elVideo.HAVE_ENOUGH_DATA) return;

    // Configurar máxima resolución
    if (processCanvas.width !== elVideo.videoWidth || processCanvas.width === 0) {
        processCanvas.width = elVideo.videoWidth;
        processCanvas.height = elVideo.videoHeight;

        // Sincronizar también la resolución del canvas visual
        if (overlayCanvas) {
            overlayCanvas.width = elVideo.videoWidth;
            overlayCanvas.height = elVideo.videoHeight;
        }
    }

    if (processCanvas.width === 0) return;

    // Copiar frame para procesar
    processCtx.drawImage(elVideo, 0, 0, processCanvas.width, processCanvas.height);
    const imageData = processCtx.getImageData(0, 0, processCanvas.width, processCanvas.height);

    // Limpiar el canvas visual en cada frame (borra cuadros viejos)
    if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    try {
        const markers = detector.detect(imageData);
        if (markers && markers.length > 0) {
            markers.forEach(marker => {
                // Registrar asistencia
                handleMarkerDetected(marker.id);

                // --- MAGIA VISUAL: DIBUJAR CUADRO VERDE ---
                if (overlayCtx) {
                    overlayCtx.lineWidth = 6; // Grosor de la línea
                    overlayCtx.strokeStyle = "#3fb950"; // Verde estilo interfaz
                    overlayCtx.beginPath();

                    // Mover el "lápiz" a la primera esquina
                    overlayCtx.moveTo(marker.corners[0].x, marker.corners[0].y);

                    // Trazar línea hacia las otras 3 esquinas
                    for (let i = 1; i < marker.corners.length; i++) {
                        overlayCtx.lineTo(marker.corners[i].x, marker.corners[i].y);
                    }

                    // Cerrar el cuadrado volviendo al inicio y pintar
                    overlayCtx.closePath();
                    overlayCtx.stroke();
                }
                // ------------------------------------------
            });
        }
    } catch (e) {
        // Silenciar errores de lectura
    }
}

// ============================================
// MANEJO DE MARKER DETECTADO
// ============================================

function handleMarkerDetected(markerId) {
    // Validar rango: solo aceptamos IDs 1-55 (numeros de lista)
    if (markerId < 1 || markerId > MAX_NUM_LISTA) {
        return; // Marker fuera de rango, ignorar
    }

    const numLista = markerId;

    // Buscar alumno en la base de datos: curso + numero de lista
    const alumnosCurso = ALUMNOS_DB[cursoSeleccionado];
    if (!alumnosCurso) {
        console.warn('Curso no encontrado en DB:', cursoSeleccionado);
        return;
    }

    const alumno = alumnosCurso[numLista];
    if (!alumno) {
        // Numero de lista sin alumno asignado en este curso
        console.log(`Numero de lista ${numLista} no tiene alumno en ${cursoSeleccionado}`);
        return;
    }

    // Anti-duplicados: verificar si ya fue registrado en esta sesion
    const claveUnica = `${cursoSeleccionado}-${numLista}`;
    if (asistenciaActual.has(claveUnica)) {
        return; // Ya registrado, ignorar silenciosamente
    }

    // Registrar asistencia
    asistenciaActual.add(claveUnica);

    const entry = {
        numLista: numLista,
        rut: alumno.rut,
        nombre: alumno.nombre,
        curso: cursoSeleccionado,
        cursoNombre: CURSOS.find(c => c.code === cursoSeleccionado)?.nombre || cursoSeleccionado,
        timestamp: Date.now()
    };

    // Actualizar UI
    updateCounter();
    updateLastDetected(entry);
    addToList(entry);
    flashScreen();

    // Enviar a servidor (demo)
    sendToServer(entry);

    console.log(`Lista ${numLista} detectada -> ${alumno.nombre} (${alumno.rut})`);
}

// ============================================
// UI - ACTUALIZACIONES
// ============================================

function updateCounter() {
    elCounter.textContent = asistenciaActual.size;
}

function updateLastDetected(entry) {
    const text = `Lista ${entry.numLista}: ${entry.nombre}`;
    elLastDetected.textContent = text;
    elLastDetected.classList.add('detected');

    setTimeout(() => {
        elLastDetected.classList.remove('detected');
    }, 1000);
}

function addToList(entry) {
    const li = document.createElement('li');
    const timeStr = new Date(entry.timestamp).toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    li.innerHTML = `
        <div class="estudiante-info">
            <span class="num-lista">N° ${entry.numLista}</span>
            <span class="rut">${entry.nombre}</span>
            <span class="curso">${entry.rut}</span>
        </div>
        <span class="time">${timeStr}</span>
    `;

    elAttendanceList.insertBefore(li, elAttendanceList.firstChild);
}

function flashScreen() {
    elFlash.classList.add('active');
    setTimeout(() => {
        elFlash.classList.remove('active');
    }, 150);
}

function toggleList() {
    elSidePanel.classList.toggle('open');
}

function clearAttendance() {
    if (!confirm('Limpiar toda la lista de asistencia?')) return;

    asistenciaActual.clear();
    elAttendanceList.innerHTML = '';
    elCounter.textContent = '0';
    elLastDetected.textContent = 'Esperando...';
}

function showError(msg) {
    elErrorMsg.textContent = msg;
    elErrorMsg.classList.remove('hidden');
}

// ============================================
// ZOOM
// ============================================

function detectZoomCapabilities() {
    if (!videoTrack) return;
    try {
        zoomCapabilities = videoTrack.getCapabilities();
        if (zoomCapabilities.zoom) {
            const min = zoomCapabilities.zoom.min || 1;
            const max = zoomCapabilities.zoom.max || 10;
            const step = zoomCapabilities.zoom.step || 0.1;
            elZoomSlider.min = min;
            elZoomSlider.max = max;
            elZoomSlider.step = step;
            elZoomSlider.value = min;
            currentZoom = min;
        } else {
            document.getElementById('zoom-panel').style.display = 'none';
        }
    } catch (e) {
        console.log('No se pudieron obtener capacidades de zoom');
    }
}

function onZoomSlider(e) {
    applyZoom(parseFloat(e.target.value));
}

function adjustZoom(delta) {
    if (!zoomCapabilities || !zoomCapabilities.zoom) return;
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
// ENVIO A SERVIDOR (DEMO)
// ============================================

function sendToServer(entry) {
    const payload = {
        numLista: entry.numLista,
        rut: entry.rut,
        nombre: entry.nombre,
        cursoCode: entry.curso,
        cursoNombre: entry.cursoNombre,
        timestamp: new Date(entry.timestamp).toISOString(),
        device: navigator.userAgent
    };
    console.log('[DEMO] Enviar al servidor:', payload);

    /*
    fetch('https://tu-servidor.com/api/asistencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => console.log('Servidor respondio:', data))
    .catch(err => console.error('Error:', err));
    */
}

// ============================================
// LIMPIEZA
// ============================================

window.addEventListener('beforeunload', () => {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
});
