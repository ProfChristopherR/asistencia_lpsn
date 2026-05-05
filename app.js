/**
 * App Web de Asistencia con ArUco
 * Escanea markers ArUco, cuenta asistencia, evita duplicados y soporta zoom.
 * Demo: 15 estudiantes, diccionario ARUCO (7x7 interno, 1024 códigos)
 */

// ============================================
// BASE DE DATOS LOCAL (DEMO - 15 ESTUDIANTES)
// ============================================
const listaEstudiantes = [
    { id: 1,  rut: "12.345.601-K", curso: "3ro Medio B" },
    { id: 2,  rut: "12.345.602-K", curso: "3ro Medio B" },
    { id: 3,  rut: "12.345.603-K", curso: "3ro Medio B" },
    { id: 4,  rut: "12.345.604-K", curso: "3ro Medio B" },
    { id: 5,  rut: "12.345.605-K", curso: "3ro Medio B" },
    { id: 6,  rut: "12.345.606-K", curso: "3ro Medio B" },
    { id: 7,  rut: "12.345.607-K", curso: "3ro Medio B" },
    { id: 8,  rut: "12.345.608-K", curso: "3ro Medio B" },
    { id: 9,  rut: "12.345.609-K", curso: "3ro Medio B" },
    { id: 10, rut: "12.345.610-K", curso: "3ro Medio B" },
    { id: 11, rut: "12.345.611-K", curso: "3ro Medio B" },
    { id: 12, rut: "12.345.612-K", curso: "3ro Medio B" },
    { id: 13, rut: "12.345.613-K", curso: "3ro Medio B" },
    { id: 14, rut: "12.345.614-K", curso: "3ro Medio B" },
    { id: 15, rut: "12.345.615-K", curso: "3ro Medio B" }
];

// Mapa rápido: markerId -> estudiante
const ESTUDIANTES_MAP = new Map();
listaEstudiantes.forEach(est => ESTUDIANTES_MAP.set(est.id, est));

// ============================================
// CONFIGURACIÓN
// ============================================
const DETECT_INTERVAL_MS = 200;  // Procesar frame cada 200ms
const PROCESS_WIDTH = 640;       // Resolución de procesamiento (ancho)

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

// Asistencia acumulativa - Set de IDs de estudiantes ya registrados
const asistenciaActual = new Set();

// Zoom
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
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Verificar que js-aruco2 cargó
    if (typeof AR === 'undefined' || typeof AR.Detector === 'undefined') {
        showError('Error: No se pudo cargar la librería de detección ArUco. Verifica tu conexión a internet.');
        elBtnStart.disabled = true;
        return;
    }

    // Crear detector con diccionario ARUCO (7x7 interno, compatible con DICT_ARUCO_ORIGINAL de OpenCV)
    detector = new AR.Detector({ dictionaryName: 'ARUCO' });

    // Canvas de procesamiento
    processCanvas = document.getElementById('process-canvas');
    processCtx = processCanvas.getContext('2d', { willReadFrequently: true });

    // Event listeners
    elBtnStart.addEventListener('click', startCamera);
    elBtnToggleList.addEventListener('click', toggleList);
    elBtnClear.addEventListener('click', clearAttendance);
    elZoomSlider.addEventListener('input', onZoomSlider);
    elZoomIn.addEventListener('click', () => adjustZoom(0.5));
    elZoomOut.addEventListener('click', () => adjustZoom(-0.5));

    // Cerrar panel al tocar fuera
    document.addEventListener('click', (e) => {
        if (elSidePanel.classList.contains('open') &&
            !elSidePanel.contains(e.target) &&
            e.target !== elBtnToggleList) {
            elSidePanel.classList.remove('open');
        }
    });
});

// ============================================
// CÁMARA
// ============================================

async function startCamera() {
    elBtnStart.disabled = true;
    elBtnStart.textContent = 'Iniciando...';

    try {
        const constraints = {
            video: {
                facingMode: 'environment', // Cámara trasera preferida
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoTrack = videoStream.getVideoTracks()[0];

        elVideo.srcObject = videoStream;

        // Esperar a que el video esté listo
        await new Promise((resolve) => {
            elVideo.onloadedmetadata = () => {
                elVideo.play();
                resolve();
            };
        });

        // Configurar canvas de procesamiento
        const aspect = elVideo.videoHeight / elVideo.videoWidth;
        processCanvas.width = PROCESS_WIDTH;
        processCanvas.height = Math.round(PROCESS_WIDTH * aspect);

        // Detectar capacidades de zoom
        detectZoomCapabilities();

        // Cambiar pantalla
        elStartScreen.classList.remove('active');
        elScannerScreen.classList.add('active');

        // Iniciar loop de detección
        isScanning = true;
        requestAnimationFrame(detectionLoop);

        console.log('Cámara iniciada. Resolución:', elVideo.videoWidth, 'x', elVideo.videoHeight);

    } catch (err) {
        console.error('Error al iniciar cámara:', err);
        let msg = 'No se pudo acceder a la cámara.';
        if (err.name === 'NotAllowedError') {
            msg = 'Permiso de cámara denegado. Por favor permite el acceso en la configuración de tu navegador.';
        } else if (err.name === 'NotFoundError') {
            msg = 'No se encontró una cámara disponible.';
        } else if (err.name === 'NotReadableError') {
            msg = 'La cámara está siendo usada por otra aplicación.';
        }
        showError(msg);
        elBtnStart.disabled = false;
        elBtnStart.textContent = 'Iniciar Cámara';
    }
}

// ============================================
// LOOP DE DETECCIÓN
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

function processFrame() {
    if (elVideo.readyState !== elVideo.HAVE_ENOUGH_DATA) return;

    // Dibujar frame actual en canvas de procesamiento (escalado)
    processCtx.drawImage(elVideo, 0, 0, processCanvas.width, processCanvas.height);

    // Obtener ImageData
    const imageData = processCtx.getImageData(0, 0, processCanvas.width, processCanvas.height);

    // Detectar markers
    try {
        const markers = detector.detect(imageData);

        if (markers && markers.length > 0) {
            markers.forEach(marker => {
                handleMarkerDetected(marker.id);
            });
        }
    } catch (e) {
        // Silenciar errores ocasionales de procesamiento
    }
}

// ============================================
// MANEJO DE MARKER DETECTADO
// ============================================

function handleMarkerDetected(markerId) {
    // Buscar estudiante por ID del marker
    const estudiante = ESTUDIANTES_MAP.get(markerId);
    if (!estudiante) return; // Marker no reconocido (no está en nuestra base de datos)

    // Verificar si ya fue registrado en esta sesión (anti-duplicados estricto)
    if (asistenciaActual.has(markerId)) {
        return; // Ya registrado, ignorar silenciosamente
    }

    // Registrar asistencia
    asistenciaActual.add(markerId);

    const entry = {
        id: estudiante.id,
        rut: estudiante.rut,
        curso: estudiante.curso,
        markerId: markerId,
        timestamp: Date.now()
    };

    // Actualizar UI
    updateCounter();
    updateLastDetected(estudiante);
    addToList(entry);
    flashScreen();

    // Enviar a servidor (demo)
    sendToServer(entry);

    console.log(`✅ Marker ${markerId} detectado -> ${estudiante.rut} (${estudiante.curso})`);
}

// ============================================
// UI - ACTUALIZACIONES
// ============================================

function updateCounter() {
    elCounter.textContent = asistenciaActual.size;
}

function updateLastDetected(estudiante) {
    const text = `✅ ${estudiante.rut} - ${estudiante.curso}`;
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
            <span class="rut">${entry.rut}</span>
            <span class="curso">${entry.curso}</span>
        </div>
        <span class="time">${timeStr}</span>
    `;

    // Insertar al principio
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
    if (!confirm('¿Limpiar toda la lista de asistencia?')) return;

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

            console.log('Zoom soportado:', min, '-', max);
        } else {
            // Zoom no soportado por este dispositivo/navegador
            document.getElementById('zoom-panel').style.display = 'none';
            console.log('Zoom no soportado por este dispositivo');
        }
    } catch (e) {
        console.log('No se pudieron obtener capacidades de zoom');
    }
}

function onZoomSlider(e) {
    const value = parseFloat(e.target.value);
    applyZoom(value);
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
        await videoTrack.applyConstraints({
            advanced: [{ zoom: value }]
        });
        currentZoom = value;
        elZoomValue.textContent = value.toFixed(1) + 'x';
    } catch (e) {
        console.error('Error aplicando zoom:', e);
    }
}

// ============================================
// ENVÍO A SERVIDOR (DEMO)
// ============================================

function sendToServer(entry) {
    // ============================================
    // TODO: Implementar integración con servidor
    // ============================================

    const payload = {
        id: entry.id,
        rut: entry.rut,
        curso: entry.curso,
        markerId: entry.markerId,
        timestamp: new Date(entry.timestamp).toISOString(),
        device: navigator.userAgent
    };

    console.log('[DEMO] Enviar al servidor:', payload);

    // Ejemplo de cómo sería con fetch (descomentar cuando tengas servidor):
    /*
    fetch('https://tu-servidor.com/api/asistencia', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer TU_TOKEN_AQUI'
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => console.log('Servidor respondió:', data))
    .catch(err => console.error('Error enviando a servidor:', err));
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
