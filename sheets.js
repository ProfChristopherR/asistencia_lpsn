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
 */
async function getNiveles(turno) {
    const spreadsheet = await getSpreadsheet(turno);
    return spreadsheet.sheets.map(s => s.properties.title);
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

        const curso = (row[0] || '').trim();
        const numListaRaw = row[1];
        const numLista = parseInt(numListaRaw, 10);

        // Si no tiene curso o número de lista, saltar
        if (!curso || isNaN(numLista)) {
            filasIgnoradas++;
            continue;
        }

        const run = (row[2] || '').trim();
        const nombre = (row[3] || '').trim();

        // Si no tiene nombre, igual lo registramos (podría ser fila vacía)
        if (!nombre) {
            filasIgnoradas++;
            continue;
        }

        if (!alumnosPorCurso[curso]) {
            alumnosPorCurso[curso] = [];
        }

        alumnosPorCurso[curso].push({
            numLista,
            run,
            nombre,
            rowIndex: i + 1 // 1-based para la API de Sheets
        });
        filasProcesadas++;
    }

    const cursos = Object.keys(alumnosPorCurso).sort();
    console.log('procesarDatosHoja: filas procesadas:', filasProcesadas, 'ignoradas:', filasIgnoradas, 'cursos:', cursos);
    for (const c of cursos) {
        console.log(`  Curso ${c}: ${alumnosPorCurso[c].length} alumnos`);
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
