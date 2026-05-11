/**
 * auth.js - Autenticación con Google Identity Services (GIS)
 * 
 * Usa el botón de Google Sign-In que maneja todo el flujo OAuth2 internamente.
 * No requiere Client Secret ni intercambio manual de code→token.
 * Compatible con GitHub Pages (SPA estática).
 */

// ============================================
// CONFIGURACIÓN
// ============================================
const GOOGLE_CLIENT_ID = '7364447610-7nk30untbp3o14go1ovskmpd91u16bvg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// ============================================
// ALMACENAMIENTO
// ============================================
const STORAGE_KEYS = {
    ACCESS_TOKEN: 'asistencia_access_token',
    EXPIRES_AT: 'asistencia_expires_at',
    USER_INFO: 'asistencia_user_info'
};

function saveToken(token, expiresIn) {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(Date.now() + expiresIn * 1000));
}

function getAccessToken() {
    return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

function getTokenExpiry() {
    return parseInt(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0', 10);
}

function isTokenValid() {
    const token = getAccessToken();
    const expiry = getTokenExpiry();
    return !!token && Date.now() < expiry - 60000;
}

function saveUserInfo(info) {
    localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(info));
}

function getUserInfo() {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_INFO);
    return raw ? JSON.parse(raw) : null;
}

function clearAuth() {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
    localStorage.removeItem(STORAGE_KEYS.USER_INFO);
}

// ============================================
// CARGAR BIBLIOTECA GIS
// ============================================

let gisLoaded = false;
let tokenClient = null;

function loadGIS() {
    return new Promise((resolve, reject) => {
        if (window.google?.accounts?.oauth2) {
            gisLoaded = true;
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            gisLoaded = true;
            resolve();
        };
        script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
        document.head.appendChild(script);
    });
}

function initTokenClient() {
    if (!window.google?.accounts?.oauth2) {
        console.error('Google Identity Services no disponible');
        return null;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error) {
                console.error('Error GIS:', tokenResponse.error);
                return;
            }
            // Guardar token
            saveToken(tokenResponse.access_token, tokenResponse.expires_in || 3600);
            // Obtener info del usuario
            fetchUserInfo(tokenResponse.access_token).then(() => {
                // Notificar a la app que el login fue exitoso
                onLoginSuccess();
            });
        }
    });

    return tokenClient;
}

// ============================================
// LOGIN / LOGOUT
// ============================================

function signInWithGoogle() {
    if (!tokenClient) {
        console.error('Token client no inicializado');
        return;
    }
    tokenClient.requestAccessToken();
}

function signOut() {
    clearAuth();
    window.location.reload();
}

function isAuthenticated() {
    return isTokenValid();
}

// ============================================
// INICIALIZACIÓN
// ============================================

async function initAuth() {
    try {
        await loadGIS();
        initTokenClient();
    } catch (err) {
        console.error('Error cargando GIS:', err);
        return { success: false, error: 'gis_load_error' };
    }

    if (isAuthenticated()) {
        return { success: true };
    }

    return { success: false };
}

// ============================================
// INFO DEL USUARIO
// ============================================

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

// ============================================
// UI HELPERS
// ============================================

let loginSuccessCallback = null;

function onLoginSuccess() {
    if (loginSuccessCallback) {
        loginSuccessCallback();
    }
}

function setLoginSuccessCallback(callback) {
    loginSuccessCallback = callback;
}

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
    renderLoginButton,
    setLoginSuccessCallback
};
