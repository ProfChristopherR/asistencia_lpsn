/**
 * datemapper.js - Mapea fechas a columnas en la hoja de asistencia
 * 
 * Estructura esperada:
 * - Fila 1: meses (MARZO, ABRIL, MAYO, JUNIO)
 * - Fila 4: días del mes (9, 10, 11... 31, 1, 2...)
 */

const MESES_NOMBRES = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

/**
 * Convierte índice de columna (0-based) a notación A1 (A, B, C... Z, AA, AB...)
 */
function colIndexToA1(index) {
    let result = '';
    let n = index;
    do {
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return result;
}

/**
 * Parsea los datos de una hoja para construir un mapa fecha → columna.
 * @param {string[][]} values - Datos brutos de la hoja (desde Sheets API)
 * @returns {Object} Mapa: { "2026-05-05": { column: "AT", colIndex: 45 }, ... }
 */
function construirMapaFechas(values) {
    if (!values || values.length < 4) {
        return {};
    }

    const filaMeses = values[0] || [];
    const filaDias = values[3] || [];
    const añoActual = new Date().getFullYear();

    // Encontrar posiciones de meses en la fila 1
    const posicionesMeses = [];
    filaMeses.forEach((cell, idx) => {
        const mes = (cell || '').trim().toUpperCase().replace('°', '');
        const mesIdx = MESES_NOMBRES.indexOf(mes);
        if (mesIdx !== -1) {
            posicionesMeses.push({ mesIdx, colIndex: idx });
        }
    });

    // Si no se encontraron meses, usar marzo como default (año escolar)
    if (posicionesMeses.length === 0) {
        console.warn('No se encontraron meses en la fila 1, usando defaults');
        posicionesMeses.push({ mesIdx: 2, colIndex: 4 }); // MARZO en col E
    }

    // Ordenar por posición de columna
    posicionesMeses.sort((a, b) => a.colIndex - b.colIndex);

    // Construir mapa de fechas
    const mapa = {};

    for (let col = 4; col < filaDias.length; col++) {
        const diaStr = filaDias[col];
        if (!diaStr) continue;

        const dia = parseInt(String(diaStr).trim(), 10);
        if (isNaN(dia) || dia < 1 || dia > 31) continue;

        // Determinar mes: encontrar el mes más cercano hacia la izquierda
        let mesIdx = posicionesMeses[0].mesIdx;

        for (let i = posicionesMeses.length - 1; i >= 0; i--) {
            if (col >= posicionesMeses[i].colIndex) {
                mesIdx = posicionesMeses[i].mesIdx;
                break;
            }
        }

        // Determinar año según mes (año escolar: mar-dic = actual, ene-feb = siguiente)
        let año = añoActual;
        if (mesIdx <= 1) { // ENERO o FEBRERO
            año = añoActual + 1;
        }

        const fecha = `${año}-${String(mesIdx + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const letraColumna = colIndexToA1(col);

        mapa[fecha] = {
            column: letraColumna,
            colIndex: col
        };
    }

    return mapa;
}

/**
 * Obtiene la columna para la fecha actual del sistema.
 * @param {Object} mapa - Mapa generado por construirMapaFechas
 * @returns {Object|null} { column, colIndex } o null si no está
 */
function getColumnaHoy(mapa) {
    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    const clave = `${yyyy}-${mm}-${dd}`;
    return mapa[clave] || null;
}

/**
 * Obtiene todas las fechas disponibles en la hoja, ordenadas.
 * @param {Object} mapa - Mapa generado por construirMapaFechas
 * @returns {string[]} Array de fechas en formato YYYY-MM-DD
 */
function getFechasDisponibles(mapa) {
    return Object.keys(mapa).sort();
}

/**
 * Formatea una fecha YYYY-MM-DD para mostrar (DD/MM/YYYY).
 */
function formatearFecha(fechaStr) {
    const [y, m, d] = fechaStr.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Obtiene el nombre del mes en español.
 */
function nombreMes(mesIdx) {
    const nombres = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return nombres[mesIdx] || '';
}

// Exportar funciones públicas
window.DateMapper = {
    construirMapaFechas,
    getColumnaHoy,
    getFechasDisponibles,
    formatearFecha,
    nombreMes,
    colIndexToA1
};
