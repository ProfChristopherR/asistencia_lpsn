/**
 * sheets.js - Wrapper para Google Sheets API v4
 * 
 * Todas las llamadas requieren un access token válido (desde auth.js).
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// IDs de los documentos
const SPREADSHEETS = {
    manana: '1MuTe0OQth2qzCKCQf5gaFQnZrhPyC-tqq7cVCYzpnyU',
    tarde: '1V7H2VXsKCvqfyJ96OX-38MmvRAHQjghLMcI4i5CqdMo'
};

/**
 * Wrapper de fetch con Bearer token automático.
 */
async function apiFetch(url, options = {}) {
    const token = window.Auth?.getAccessToken?.();
    if (!token) {
        throw new Error('No hay token de autenticación');
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        console.error('Error 401 detalle:', data);
        throw new Error('TOKEN_EXPIRED');
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    return data;
}

/**
 * Obtiene metadata del spreadsheet (nombre, lista de hojas).
 */
async function getSpreadsheet(turno) {
    const id = SPREADSHEETS[turno];
    if (!id) throw new Error('Turno no válido');

    const url = `${SHEETS_API_BASE}/${id}?fields=properties.title,sheets.properties(title,sheetId)`;
    return apiFetch(url);
}

/**
 * Obtiene todos los datos de una hoja específica.
 * range: "6°!A1:CA300" (hasta columna CA que cubre ~80 columnas)
 */
async function getSheetData(turno, sheetName) {
    const id = SPREADSHEETS[turno];
    const range = `${sheetName}!A1:CA300`;
    const url = `${SHEETS_API_BASE}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
    return apiFetch(url);
}

/**
 * Escribe múltiples celdas en batch.
 * updates: array de { range, values: [[valor]] }
 */
async function batchUpdateValues(turno, updates) {
    const id = SPREADSHEETS[turno];
    const url = `${SHEETS_API_BASE}/${id}/values:batchUpdate`;

    const body = {
        valueInputOption: 'RAW',
        data: updates
    };

    return apiFetch(url, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

/**
 * Obtiene lista de niveles (nombres de hojas) de un turno.
 * Filtra solo hojas con formato de nivel válido:
 * - 6°, 7°, 8°, 1°, 2°, 3°, 4° (número + °)
 * - EPJA (educación para jóvenes y adultos)
 * 
 * Ignora hojas como "Hoja 1", "Plantilla", etc.
 */
async function getNiveles(turno) {
    const spreadsheet = await getSpreadsheet(turno);
    const todos = spreadsheet.sheets.map(s => s.properties.title);

    // Patrón válido: número seguido de ° opcionalmente con espacios
    // o exactamente "EPJA" (con o sin espacios)
    // Ejemplos válidos: "6°", "7° ", " 1°", "EPJA", "EPJA "
    const patronValido = /^\s*(\d+\s*°|EPJA)\s*$/i;

    const filtrados = todos.filter(nombre => {
        const limpio = nombre.trim();
        // Aceptar: números seguidos de CUALQUIER símbolo que no sea letra/dígito
        // Esto captura °, º, o, ⁰, ˚, etc. sin importar el Unicode exacto
        // Ej: 6°, 7°, 8°, 1°, 2º, 3º, 4º, 10°, 11º, etc.
        // o EPJA (case insensitive)
        // Patrón: empieza con 1+ dígitos, opcionalmente espacios, 
        //          luego 1+ caracteres NO alfanuméricos, fin de string
        const esNumeroConSimbolo = /^\d+\s*[^a-zA-Z0-9\s]+$/.test(limpio);
        const esEPJA = /^EPJA$/i.test(limpio);
        return esNumeroConSimbolo || esEPJA;
    });

    // Ordenar niveles: 6°, 7°, 8°, 1°, 2°, 3°, 4°, EPJA
    const ordenNiveles = { '6': 1, '7': 2, '8': 3, '1': 4, '2': 5, '3': 6, '4': 7 };
    filtrados.sort((a, b) => {
        const numA = a.match(/^(\d+)/)?.[1];
        const numB = b.match(/^(\d+)/)?.[1];
        const ordA = numA ? (ordenNiveles[numA] || 99) : 99;
        const ordB = numB ? (ordenNiveles[numB] || 99) : 99;
        if (ordA !== ordB) return ordA - ordB;
        // EPJA va al final
        if (/^EPJA$/i.test(a)) return 1;
        if (/^EPJA$/i.test(b)) return -1;
        return a.localeCompare(b);
    });

    console.log('Hojas encontradas:', todos);
    console.log('Hojas filtradas (niveles válidos):', filtrados);

    return filtrados;
}

/**
 * Procesa los datos brutos de una hoja para extraer cursos y alumnos.
 * Retorna: { cursos: string[], alumnosPorCurso: { curso: Alumno[] } }
 */
function procesarDatosHoja(values) {
    if (!values || values.length < 5) {
        console.log('procesarDatosHoja: datos insuficientes, filas:', values?.length);
        return { cursos: [], alumnosPorCurso: {} };
    }

    console.log('procesarDatosHoja: total filas recibidas:', values.length);

    const alumnosPorCurso = {};
    let filasProcesadas = 0;
    let filasIgnoradas = 0;
    let cursoActual = null; // Trackea el curso actual para oyentes

    // Empezar desde la fila 5 (índice 4) que es donde están los datos
    for (let i = 4; i < values.length; i++) {
        const row = values[i];

        // Log de las primeras filas para debug
        if (i < 10) {
            console.log(`Fila ${i + 1} (idx ${i}):`, row);
        }

        if (!row || row.length < 2) {
            filasIgnoradas++;
            continue;
        }

        const colA = (row[0] || '').trim();
        const numListaRaw = row[1];
        const numLista = parseInt(String(numListaRaw).trim(), 10);

        // Si no tiene contenido en columna A o número de lista inválido, saltar
        if (!colA || isNaN(numLista)) {
            filasIgnoradas++;
            continue;
        }

        // Detectar si es OYENTE
        const esOyente = /^OYENTE/i.test(colA);

        // Determinar el curso asignado
        let cursoAsignado;
        if (esOyente) {
            // Oyente: usar el curso actual (el último curso normal encontrado)
            if (!cursoActual) {
                console.log(`Fila ${i + 1}: OYENTE sin curso anterior, ignorando`);
                filasIgnoradas++;
                continue;
            }
            cursoAsignado = cursoActual;
            console.log(`Fila ${i + 1}: OYENTE detectado -> asignado a ${cursoAsignado}`);
        } else {
            // Curso normal: actualizar cursoActual
            cursoAsignado = colA;
            cursoActual = colA;
        }

        const run = (row[2] || '').trim();
        const nombre = (row[3] || '').trim();

        // Si no tiene nombre, ignorar
        if (!nombre) {
            filasIgnoradas++;
            continue;
        }

        if (!alumnosPorCurso[cursoAsignado]) {
            alumnosPorCurso[cursoAsignado] = [];
        }

        alumnosPorCurso[cursoAsignado].push({
            numLista,
            run,
            nombre,
            rowIndex: i + 1, // 1-based para la API de Sheets
            esOyente: esOyente
        });
        filasProcesadas++;
    }

    const cursos = Object.keys(alumnosPorCurso).sort();
    console.log('procesarDatosHoja: filas procesadas:', filasProcesadas, 'ignoradas:', filasIgnoradas, 'cursos:', cursos);
    for (const c of cursos) {
        const total = alumnosPorCurso[c].length;
        const oyentes = alumnosPorCurso[c].filter(a => a.esOyente).length;
        console.log(`  Curso ${c}: ${total} alumnos (${oyentes} oyentes)`);
    }

    return { cursos, alumnosPorCurso };
}

// Exportar funciones públicas
window.Sheets = {
    SPREADSHEETS,
    getSpreadsheet,
    getSheetData,
    batchUpdateValues,
    getNiveles,
    procesarDatosHoja
};
