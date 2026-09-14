// js/auth.js

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', 
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec',
    //Url: https://script.google.com/home/projects/1pZbca-IQ9peOsYBflHbdq1L4xTmHQAHQhY2hPA93skMRk9Dg5KePNZUU/edit
};

const APP_ASSETS = {
    css: ['css/components.css'],
    js: [
        'https://cdn.jsdelivr.net/npm/chart.js',
        'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
        'js/config.js',
        'js/data-service.js',
        'js/ui-render.js',
        'js/about-popup.js'
    ]
};

// ---------------------------------------------------------------------------
// 1. Cookie Helpers (Dual Storage)
// ---------------------------------------------------------------------------
function setCookie(name, value, days = 7) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;secure;samesite=strict`;
}

function getCookie(name) {
    const cname = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1);
        if (c.indexOf(cname) == 0) return c.substring(cname.length, c.length);
    }
    return "";
}

function clearAuthCaches() {
    localStorage.removeItem('app_user_cache');
    setCookie('sessionId', '', -1);
    setCookie('userId', '', -1);
}

// ---------------------------------------------------------------------------
// State Guards & UI Elements
// ---------------------------------------------------------------------------
let authInitializing = false; 
let authCompleted = false; 
let logoutInProgress = false;

const ui = {
    splash: document.getElementById('splashScreen'),
    splashStatus: document.getElementById('splashStatus'),
    login: document.getElementById('loginPage'),
    error: document.getElementById('errorPage'),
    errorReason: document.getElementById('errorReason'),
    follow: document.getElementById('followPage'),
    app: document.getElementById('appWrapper'),
    loginBtn: document.getElementById('lineLoginBtn'),
    logoutBtn: document.getElementById('lineLogoutBtn')
};

// ---------------------------------------------------------------------------
// 3. Remove Button Freeze (ปลดล็อคปุ่มล็อกอิน)
// ---------------------------------------------------------------------------
if (ui.loginBtn) {
    ui.loginBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        if (typeof liff !== 'undefined' && liff.isLoggedIn()) return;
        // ยิงคำสั่ง liff.login() ทันที โดยไม่บล็อก UI เพื่อลดปัญหา OS สลับแอปแล้วค้าง
        liff.login(); 
    });
}

if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', async () => {
        ui.logoutBtn.disabled = true;
        await logoutCurrentSession_();
    });
}

// ---------------------------------------------------------------------------
// 2. Fast Boot & Initialization
// ---------------------------------------------------------------------------
async function initApp() {
    if (authInitializing) return;
    authInitializing = true;

    try {
        const cachedUserStr = localStorage.getItem('app_user_cache');
        const cookieSession = getCookie('sessionId');
        
        // แบบ Cache-First: โหลดเข้า Dashboard ทันทีถ้ามี Cache หรือ Cookie
        if (cachedUserStr && cookieSession) {
            console.log('Cache Hit: Fast booting app...');
            await loadAppAssets();
            showApp();

            // เริ่มการตรวจสอบเบื้องหลังอย่างเงียบๆ
            if (typeof liff !== 'undefined') {
                await liff.init({ liffId: AUTH_CONFIG.liffId });
                if (liff.isLoggedIn()) {
                    await backgroundVerify();
                }
            }
            return;
        }

        // กรณีไม่มี Cache -> แสดงหน้า Login เต็มจอ
        showLogin();
        await liff.init({ liffId: AUTH_CONFIG.liffId });

        if (liff.isLoggedIn()) {
            ui.splashStatus.innerText = 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...';
            showSplash();
            
            const friendship = await liff.getFriendship();
            if (!friendship.friendFlag) {
                showFollowPrompt();
                return;
            }

            const profile = await liff.getProfile();
            await verifyWithBackend(profile);
        }
    } catch (error) {
        console.error('LIFF Init Error:', error);
        showError('ไม่สามารถเชื่อมต่อระบบ LINE ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
        authInitializing = false;
    }
}

// ---------------------------------------------------------------------------
// 4. Background Verification & Auth Calls
// ---------------------------------------------------------------------------
async function backgroundVerify() {
    try {
        const cachedUser = JSON.parse(localStorage.getItem('app_user_cache') || '{}');
        const sessionId = getCookie('sessionId') || cachedUser.sessionId;
        const profile = await liff.getProfile();

        if (!sessionId) {
            clearLocalSessionAndRedirect_('ไม่สามารถระบุอุปกรณ์ของคุณได้ กรุณาเข้าสู่ระบบใหม่');
            return false;
        }

        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'verify_session',
                action: 'verify_session',
                userId: profile.userId,
                sessionId: sessionId
            })
        });
        
        const result = await parseJsonResponseSafe_(response, 'verify_session');

        if (!result.success && !result.ok) {
            let msg = result.reason === 'SESSION_LOGGED_OUT' ? 'คุณถูกออกจากระบบจากอุปกรณ์นี้' : 'สิทธิ์การเข้าใช้งานหมดอายุ';
            clearLocalSessionAndRedirect_(msg);
            return false;
        }

        if (typeof window.setLastVerifiedAt === 'function') {
            window.setLastVerifiedAt(Date.now());
        }
        return true;

    } catch (error) {
        console.warn('Background verify network err', error);
        return false;
    }
}

async function verifyWithBackend(profile) {
    try {
        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'login_auth',
                action: 'login_auth',
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                os: liff.getOS(),
                isInClient: liff.isInClient(),
                userAgentRaw: navigator.userAgent
            })
        });

        const result = await parseJsonResponseSafe_(response, 'login_auth');
        
        if (result.success || result.ok) {
            // เขียน Cache ลงทั้ง LocalStorage และ Cookie
            const userData = {
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                role: result.role,
                sessionId: result.sessionId,
                timestamp: Date.now()
            };
            
            localStorage.setItem('app_user_cache', JSON.stringify(userData));
            setCookie('sessionId', result.sessionId, 7);
            setCookie('userId', profile.userId, 7);

            if (typeof window.setLastVerifiedAt === 'function') window.setLastVerifiedAt(Date.now());

            ui.splashStatus.innerText = 'กำลังดาวน์โหลดข้อมูลระบบ...';
            await loadAppAssets();
            showApp();
        } else if (result.needFollow) {
            showFollowPrompt(result.reason);
        } else {
            showError(result.reason || 'ไม่ได้รับสิทธิ์เข้าใช้งาน');
        }
    } catch (error) {
        console.error('Verify Auth Error:', error);
        showError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ตรวจสอบสิทธิ์');
    }
}

async function parseJsonResponseSafe_(response, contextLabel) {
    const rawText = await response.text();
    try {
        return JSON.parse(rawText);
    } catch (e) {
        console.error(`[${contextLabel}] Invalid JSON:`, rawText.slice(0, 200));
        throw new Error(`${contextLabel}: backend ส่งข้อมูลที่ไม่ใช่ JSON กลับมา`);
    }
}

function clearLocalSessionAndRedirect_(message) {
    clearAuthCaches();
    if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
        try { liff.logout(); } catch (e) {}
    }
    alert(message || 'คุณถูกออกจากระบบ กรุณาเข้าสู่ระบบใหม่');
    window.location.reload();
}
window.clearLocalSessionAndRedirect_ = clearLocalSessionAndRedirect_;

async function logoutCurrentSession_() {
    if (logoutInProgress) return false;
    logoutInProgress = true;

    showSplash('กำลังออกจากระบบ...');

    try {
        const cachedUser = JSON.parse(localStorage.getItem('app_user_cache') || '{}');
        const sessionId = getCookie('sessionId') || cachedUser.sessionId;
        
        if (sessionId) {
            await fetch(AUTH_CONFIG.gasUrl, {
                method: 'POST',
                body: JSON.stringify({
                    actionType: 'logout_session',
                    action: 'logout_session',
                    userId: cachedUser.userId || getCookie('userId'),
                    sessionId: sessionId,
                    targetSessionId: sessionId
                })
            });
        }

        clearAuthCaches();
        if (typeof liff !== 'undefined' && liff.isLoggedIn()) liff.logout();
        window.location.reload();
        return true;
    } catch (error) {
        console.error('Logout error:', error);
        alert('ไม่สามารถบันทึกการออกจากระบบได้ กรุณาลองใหม่อีกครั้ง');
        showApp(); // Revert UI on error
        return false;
    } finally {
        logoutInProgress = false;
    }
}
window.logoutCurrentSession_ = logoutCurrentSession_;

// ---------------------------------------------------------------------------
// 5. Visibility Change Listener (Auto-reload on Cache creation)
// ---------------------------------------------------------------------------
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !authCompleted) {
        const hasCache = localStorage.getItem('app_user_cache') || getCookie('sessionId');
        if (hasCache) {
            console.log('Detected valid cache on app switch, reloading...');
            window.location.reload();
        }
    }
});

// ---------------------------------------------------------------------------
// Asset Loaders & App UI State Managers
// ---------------------------------------------------------------------------
function getAssetCacheBuster_() {
    return window.__APP_VERSION || new URLSearchParams(window.location.search).get('appVersion') || new Date().toISOString().slice(0, 10);
}

function withCacheBuster_(href) {
    if (/^https?:\/\//i.test(href)) return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}v=${encodeURIComponent(getAssetCacheBuster_())}`;
}

async function loadAppAssets() {
    const cssPromises = APP_ASSETS.css.map(href => new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = withCacheBuster_(href);
        link.onload = resolve;
        link.onerror = resolve;
        document.head.appendChild(link);
    }));
    await Promise.all(cssPromises);

    for (const src of APP_ASSETS.js) {
        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = withCacheBuster_(src);
            script.onload = resolve;
            script.onerror = resolve;
            document.body.appendChild(script);
        });
    }
}

function showApp() {
    authCompleted = true; 
    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.remove('is-hidden');
    ui.app.style.display = 'block';

    if (typeof window.initProfileUI === 'function') window.initProfileUI();
    if (typeof window.initDashboardApp === 'function') window.initDashboardApp();
}

function showLogin() {
    if (authCompleted) return;
    ui.splash.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.login.classList.remove('is-hidden');
}

function showSplash(msg) {
    ui.app.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.splash.classList.remove('is-hidden');
    ui.splash.style.display = 'flex';
    if (msg) ui.splashStatus.innerText = msg;
}

function showError(reasonText) {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.error.classList.remove('is-hidden');
    ui.errorReason.innerText = reasonText;
}

function showFollowPrompt(reasonText) {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    if (ui.follow) {
        ui.follow.classList.remove('is-hidden');
        if (ui.followReason && reasonText) ui.followReason.innerText = reasonText;
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

