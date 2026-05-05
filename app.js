/**
 * App Web de Asistencia con ArUco
 * Escanea markers ArUco, cuenta asistencia, evita duplicados y soporta zoom.
 */

// ============================================
// CONFIGURACIÓN
// ============================================
const RUT_MAP = {
    0: "18771609",
    1: "11856556"
};

const COOLDOWN_MS = 5000;        // No repetir el mismo RUT por 5 segundos
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

// Asistencia
const detectedRuts = new Set();
const detectionLog = []; // { rut, timestamp, markerId }
const cooldownMap = new Map(); // rut -> timestamp última detección

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

    // Crear detector con diccionario ARUCO (compatible con DICT_ARUCO_ORIGINAL de OpenCV)
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
    const rut = RUT_MAP[markerId];
    if (!rut) return; // Marker no reconocido

    const now = Date.now();

    // Verificar cooldown (anti-duplicados)
    const lastTime = cooldownMap.get(rut);
    if (lastTime && (now - lastTime) < COOLDOWN_MS) {
        return; // Aún en cooldown
    }

    // Registrar detección
    cooldownMap.set(rut, now);

    const isNew = !detectedRuts.has(rut);
    if (isNew) {
        detectedRuts.add(rut);
    }

    const entry = {
        rut: rut,
        markerId: markerId,
        timestamp: now,
        isNew: isNew
    };
    detectionLog.push(entry);

    // Actualizar UI
    updateCounter();
    updateLastDetected(rut, isNew);
    addToList(entry);
    flashScreen();

    // Enviar a servidor (demo)
    sendToServer(rut, isNew);

    console.log(`Marker ${markerId} detectado -> RUT ${rut} (${isNew ? 'NUEVO' : 'ya registrado'})`);
}

// ============================================
// UI - ACTUALIZACIONES
// ============================================

function updateCounter() {
    elCounter.textContent = detectedRuts.size;
}

function updateLastDetected(rut, isNew) {
    const text = isNew
        ? `✅ RUT ${rut} registrado`
        : `🔄 RUT ${rut} (ya estaba)`;
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
        <span class="rut">${entry.rut}</span>
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

    detectedRuts.clear();
    detectionLog.length = 0;
    cooldownMap.clear();
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

function sendToServer(rut, isNew) {
    // ============================================
    // TODO: Implementar integración con servidor
    // ============================================

    const payload = {
        rut: rut,
        timestamp: new Date().toISOString(),
        isNew: isNew,
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
