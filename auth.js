/**
 * auth.js - Módulo de Autenticación OAuth2 PKCE con Google
 * 
 * Flujo Authorization Code Flow con PKCE (client-side, sin backend).
 * Compatible con GitHub Pages (SPA estática).
 */

// ============================================
// CONFIGURACIÓN - EDITAR CON TU CLIENT ID
// ============================================
const GOOGLE_CLIENT_ID = '7364447610-7nk30untbp3o14go1ovskmpd91u16bvg.apps.googleusercontent.com';
const GOOGLE_REDIRECT_URI = window.location.origin + window.location.pathname;
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// ============================================
// UTILIDADES PKCE
// ============================================

function generateCodeVerifier() {
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    return base64URLEncode(array);
}

async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64URLEncode(new Uint8Array(digest));
}

function base64URLEncode(buffer) {
    return btoa(String.fromCharCode(...buffer))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function generateState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return base64URLEncode(array);
}

// ============================================
// ALMACENAMIENTO DE TOKENS (sessionStorage)
// ============================================

const STORAGE_KEYS = {
    ACCESS_TOKEN: 'asistencia_access_token',
    EXPIRES_AT: 'asistencia_expires_at',
    USER_INFO: 'asistencia_user_info'
};

function saveToken(token, expiresIn) {
    sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
    sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(Date.now() + expiresIn * 1000));
}

function getAccessToken() {
    return sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

function getTokenExpiry() {
    return parseInt(sessionStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0', 10);
}

function isTokenValid() {
    const token = getAccessToken();
    const expiry = getTokenExpiry();
    return !!token && Date.now() < expiry - 60000; // Margen de 1 minuto
}

function saveUserInfo(info) {
    sessionStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(info));
}

function getUserInfo() {
    const raw = sessionStorage.getItem(STORAGE_KEYS.USER_INFO);
    return raw ? JSON.parse(raw) : null;
}

function clearAuth() {
    sessionStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
    sessionStorage.removeItem(STORAGE_KEYS.USER_INFO);
}

// ============================================
// FLUJO DE LOGIN
// ============================================

/**
 * Inicia el flujo OAuth2 PKCE redirigiendo a Google.
 */
async function signInWithGoogle() {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Guardar verifier y state para validar al volver
    sessionStorage.setItem('asistencia_code_verifier', codeVerifier);
    sessionStorage.setItem('asistencia_state', state);

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: state,
        access_type: 'online',
        prompt: 'consent'
    });

    window.location.href = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Maneja el redirect de vuelta desde Google.
 * Extrae el code, intercambia por token, y guarda.
 * Retorna true si se procesó un login exitoso.
 */
async function handleAuthRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');

    if (error) {
        console.error('Error OAuth:', error);
        return { success: false, error };
    }

    if (!code) {
        return { success: false }; // No hay code, no es un redirect de auth
    }

    // Validar state (CSRF protection)
    const savedState = sessionStorage.getItem('asistencia_state');
    if (state !== savedState) {
        console.error('State mismatch - posible ataque CSRF');
        return { success: false, error: 'state_mismatch' };
    }

    const codeVerifier = sessionStorage.getItem('asistencia_code_verifier');
    if (!codeVerifier) {
        console.error('No se encontró code_verifier');
        return { success: false, error: 'no_verifier' };
    }

    try {
        const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: code,
                client_id: GOOGLE_CLIENT_ID,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code',
                code_verifier: codeVerifier
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Error intercambiando code:', data);
            return { success: false, error: data.error };
        }

        // Guardar token
        saveToken(data.access_token, data.expires_in);

        // Limpiar parámetros de URL (quitar ?code=...)
        window.history.replaceState({}, document.title, GOOGLE_REDIRECT_URI);

        // Limpiar sessionStorage temporal
        sessionStorage.removeItem('asistencia_code_verifier');
        sessionStorage.removeItem('asistencia_state');

        // Obtener info del usuario
        await fetchUserInfo(data.access_token);

        return { success: true };

    } catch (err) {
        console.error('Error en token exchange:', err);
        return { success: false, error: 'network_error' };
    }
}

/**
 * Obtiene información básica del usuario autenticado.
 */
async function fetchUserInfo(accessToken) {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (response.ok) {
            const info = await response.json();
            saveUserInfo(info);
        }
    } catch (e) {
        console.error('Error obteniendo user info:', e);
    }
}

/**
 * Cierra sesión y limpia todo.
 */
function signOut() {
    clearAuth();
    window.location.reload();
}

/**
 * Verifica si hay una sesión activa y válida.
 */
function isAuthenticated() {
    return isTokenValid();
}

/**
 * Inicializa el módulo de auth. Debe llamarse al cargar la app.
 * Retorna { success: boolean, error?: string }
 */
async function initAuth() {
    // Primero intentar procesar un redirect de Google
    const redirectResult = await handleAuthRedirect();
    if (redirectResult.success) {
        return { success: true };
    }
    if (redirectResult.error) {
        return redirectResult;
    }

    // No es un redirect, verificar si ya hay sesión
    if (isAuthenticated()) {
        return { success: true };
    }

    return { success: false };
}

// ============================================
// UI HELPERS
// ============================================

function renderLoginButton(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const user = getUserInfo();
    if (isAuthenticated() && user) {
        container.innerHTML = `
            <div class="user-info">
                <img src="${user.picture || ''}" alt="" class="user-avatar" onerror="this.style.display='none'">
                <span class="user-name">${user.name || user.email}</span>
                <button id="btn-logout" class="btn-small">Cerrar sesión</button>
            </div>
        `;
        document.getElementById('btn-logout')?.addEventListener('click', signOut);
    } else {
        container.innerHTML = `
            <button id="btn-login" class="btn-google">
                <svg class="google-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Iniciar sesión con Google
            </button>
        `;
        document.getElementById('btn-login')?.addEventListener('click', signInWithGoogle);
    }
}

// Exportar funciones públicas
window.Auth = {
    initAuth,
    isAuthenticated,
    getAccessToken,
    getUserInfo,
    signInWithGoogle,
    signOut,
    renderLoginButton
};
