// js/auth.js

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec',
    //Url: https://script.google.com/home/projects/1pZbca-IQ9peOsYBflHbdq1L4xTmHQAHQhY2hPA93skMRk9Dg5KePNZUU/edit
};

const APP_ASSETS = {
    css: [
        'css/components.css'
    ],
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
// Auth / Login state guards
// ---------------------------------------------------------------------------
const LOGIN_PENDING_KEY = 'line_login_pending';

let loginInProgress = false;   
let authInitializing = false;  
let authCompleted = false;     
let logoutInProgress = false;

// UI Elements
const ui = {
    splash: document.getElementById('splashScreen'),
    splashStatus: document.getElementById('splashStatus'),
    login: document.getElementById('loginPage'),
    error: document.getElementById('errorPage'),
    errorReason: document.getElementById('errorReason'),
    follow: document.getElementById('followPage'),
    followReason: document.getElementById('followReason'),
    app: document.getElementById('appWrapper'),
    loginBtn: document.getElementById('lineLoginBtn'),
    logoutBtn: document.getElementById('lineLogoutBtn'),
    recheckFriendBtn: document.getElementById('btnRecheckFriend')
};

const LOGIN_BTN_DEFAULT_HTML = ui.loginBtn ? ui.loginBtn.innerHTML : '';

function setLoginButtonLoading(isLoading) {
    if (!ui.loginBtn) return;

    if (isLoading) {
        ui.loginBtn.disabled = true;
        ui.loginBtn.innerHTML =
            '<span class="btn_line_spinner" aria-hidden="true"></span>' +
            '<span>กำลังเชื่อมต่อ LINE...</span>';
    } else {
        ui.loginBtn.disabled = false;
        ui.loginBtn.innerHTML = LOGIN_BTN_DEFAULT_HTML;
    }
}

// Event Listeners สำหรับหน้า Login / Error
ui.loginBtn.addEventListener('click', () => {
    if (loginInProgress) return;
    if (!liff || liff.isLoggedIn()) return;

    loginInProgress = true;
    setLoginButtonLoading(true); 

    try {
        sessionStorage.setItem(LOGIN_PENDING_KEY, '1');
    } catch (e) {
        console.warn('ไม่สามารถบันทึกสถานะ Login ลง sessionStorage ได้', e);
    }

    const cleanRedirectUrl = window.location.origin + window.location.pathname;

    liff.login({
        redirectUri: cleanRedirectUrl
    });
});

ui.logoutBtn.addEventListener('click', async () => {
    if (ui.logoutBtn) ui.logoutBtn.disabled = true;
    const didLogout = await logoutCurrentSession_();
    if (!didLogout && ui.logoutBtn) ui.logoutBtn.disabled = false;
});

if (ui.recheckFriendBtn) {
    ui.recheckFriendBtn.addEventListener('click', () => {
        window.location.reload();
    });
}

// ---------------------------------------------------------------------------
// Friendship Check
// ---------------------------------------------------------------------------
async function checkFriendshipClientSide() {
    try {
        const friendship = await liff.getFriendship();
        return friendship.friendFlag; // true / false
    } catch (error) {
        console.warn('ไม่สามารถตรวจสอบสถานะเพื่อนฝั่ง client ได้', error);
        return null;
    }
}

function isLoginPending() {
    try {
        return sessionStorage.getItem(LOGIN_PENDING_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function clearLoginPending() {
    try {
        sessionStorage.removeItem(LOGIN_PENDING_KEY);
    } catch (e) {
        // ignore
    }
}

// Initialization Flow
async function initApp() {
    if (authInitializing) {
        console.log('Auth initialization already running.');
        return;
    }
    authInitializing = true;

    try {
        // ตรวจสอบ Cache (Offline-First)
        const cachedUserStr = localStorage.getItem('app_user_cache');
        if (cachedUserStr) {
            const cachedUser = JSON.parse(cachedUserStr);
            console.log('Cache Hit: Loading App immediately for', cachedUser.displayName);

            await loadAppAssets();
            showApp();

            if (liff) {
                await liff.init({ liffId: AUTH_CONFIG.liffId });

                console.log('LIFF initialized:', liff.isLoggedIn());
                console.log('LOGIN BUTTON COUNT:', document.querySelectorAll('#lineLoginBtn').length);

                if (liff.isLoggedIn()) {
                    // รอให้ migration ของ cache เก่าสร้าง session เสร็จก่อน
                    // เพื่อไม่ให้ผู้ใช้เข้าแอปต่อได้โดยไม่มี ActiveSessions record
                    await backgroundVerify();
                }
            }
            return;
        }

        // กรณีไม่มี Cache -> Initialize LIFF
        ui.splashStatus.innerText = 'กำลังเชื่อมต่อ LINE...';
        await liff.init({ liffId: AUTH_CONFIG.liffId });

        console.log('LIFF initialized:', liff.isLoggedIn());
        console.log('LOGIN BUTTON COUNT:', document.querySelectorAll('#lineLoginBtn').length);

        // ต้องตรวจ liff.isLoggedIn() หลัง liff.init() เสร็จก่อนเสมอ
        // ถ้า true ห้ามเรียก showLogin() ไม่ว่ากรณีใด ๆ
        if (!liff.isLoggedIn()) {
            // กลับมาจาก LINE แต่ยังไม่ login แปลว่าผู้ใช้กดยกเลิก/ล้มเหลว
            if (isLoginPending()) {
                clearLoginPending();
                loginInProgress = false;
                setLoginButtonLoading(false); 
            }
            showLogin();
        } else {
            if (isLoginPending()) {
                clearLoginPending();
            }
            loginInProgress = false;

            ui.splashStatus.innerText = 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...';

            const isFriendClientSide = await checkFriendshipClientSide();
            if (isFriendClientSide === false) {
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

// ฟังก์ชันล้างข้อมูล Session เครื่องและนำกลับสู่หน้าล็อกอิน
function clearLocalSessionAndRedirect_(message) {
    localStorage.removeItem('app_user_cache');
    try {
        if (typeof openCacheDB === 'function') {
            openCacheDB().then(db => {
                const tx = db.transaction("cache_store", "readwrite");
                tx.objectStore("cache_store").delete("BPNP_DOC_CACHE");
            }).catch(() => {});
        }
    } catch (e) {}

    if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
        try { liff.logout(); } catch (e) {}
    }
    alert(message || 'คุณถูกออกจากระบบจากอุปกรณ์นี้ กรุณาเข้าสู่ระบบใหม่');
    window.location.reload();
}
window.clearLocalSessionAndRedirect_ = clearLocalSessionAndRedirect_;

// Logout โดยผู้ใช้ต้องแจ้ง backend ก่อน เพื่อเปลี่ยน ActiveSessions เป็น LoggedOut
async function logoutCurrentSession_() {
    if (logoutInProgress) return false;
    logoutInProgress = true;

    try {
        let cachedUser = {};
        try {
            cachedUser = JSON.parse(localStorage.getItem('app_user_cache') || '{}');
        } catch (cacheError) {
            console.warn('Invalid local user cache during logout:', cacheError);
        }
        const hasSession = cachedUser.userId && cachedUser.sessionId;

        // Cache จากระบบก่อนมี ActiveSessions ไม่มี sessionId จึงไม่มีแถวให้ปิด
        if (hasSession) {
            const response = await fetch(AUTH_CONFIG.gasUrl, {
                method: 'POST',
                body: JSON.stringify({
                    actionType: 'logout_session',
                    action: 'logout_session',
                    userId: cachedUser.userId,
                    sessionId: cachedUser.sessionId,
                    targetSessionId: cachedUser.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`Logout request failed: HTTP ${response.status}`);
            }

            const result = await parseJsonResponseSafe_(response, 'logout_session');
            
            if (!result.success && !result.ok) {
                // Session ที่ถูกปิด/หมดอายุไปแล้ว ไม่จำเป็นต้อง retry และออกจาก LIFF ได้เลย
                if (!['SESSION_NOT_FOUND', 'SESSION_LOGGED_OUT', 'REQUESTER_SESSION_INVALID', 'TARGET_SESSION_NOT_FOUND'].includes(result.reason)) {
                    throw new Error(result.reason || 'Backend rejected logout request');
                }
            }
        }

        if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
            liff.logout();
        }
        localStorage.removeItem('app_user_cache');
        window.location.reload();
        return true;
    } catch (error) {
        console.error('Unable to record logout session:', error);
        alert('ไม่สามารถบันทึกการออกจากระบบได้ กรุณาลองใหม่อีกครั้ง');
        return false;
    } finally {
        logoutInProgress = false;
    }
}
window.logoutCurrentSession_ = logoutCurrentSession_;

// ตรวจสอบสิทธิ์กับ Backend (สำหรับ First Login) พร้อมสร้าง Session
async function verifyWithBackend(profile) {
    try {
        const os = (typeof liff !== 'undefined' && typeof liff.getOS === 'function') ? liff.getOS() : 'web';
        const isInClient = (typeof liff !== 'undefined' && typeof liff.isInClient === 'function') ? liff.isInClient() : false;
        const userAgentRaw = navigator.userAgent || '';

        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'login_auth',
                action: 'login_auth',
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                os: os,
                isInClient: isInClient,
                userAgentRaw: userAgentRaw
            })
        });

        const result = await parseJsonResponseSafe_(response, 'login_auth');
        
        if (result.success || result.ok) {
            localStorage.setItem('app_user_cache', JSON.stringify({
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                role: result.role,
                sessionId: result.sessionId || '',
                timestamp: new Date().getTime()
            }));

            if (typeof window.setLastVerifiedAt === 'function') {
                window.setLastVerifiedAt(Date.now());
            }

            ui.splashStatus.innerText = 'กำลังดาวน์โหลดข้อมูลระบบ...';
            await loadAppAssets();
            showApp();
        } else if (result.needFollow) {
            showFollowPrompt(result.reason);
        } else {
            showError(result.reason || 'ไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        }
    } catch (error) {
        console.error('Verify Auth Error:', error);
        showError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ตรวจสอบสิทธิ์');
    }
}

// ตรวจสอบสิทธิ์แบบ Background (ตรวจ User Status + ตรวจ Session ใน ActiveSessions)
// อ่าน response เป็น JSON อย่างปลอดภัย — ถ้า backend (Apps Script) ตอบกลับเป็น HTML
// (เช่น หน้า error/sign-in ของ Google เวลา deployment/permission มีปัญหา) จะได้ error
// ที่สื่อความหมายชัดเจน แทน SyntaxError ดิบๆ จาก JSON.parse
async function parseJsonResponseSafe_(response, contextLabel) {
    const rawText = await response.text();
    try {
        return JSON.parse(rawText);
    } catch (e) {
        console.error(`[${contextLabel}] Backend ตอบกลับไม่ใช่ JSON (อาจเป็นปัญหาที่ Apps Script deployment/permission):`, rawText.slice(0, 200));
        throw new Error(`${contextLabel}: backend ส่งข้อมูลที่ไม่ใช่ JSON กลับมา`);
    }
}

async function backgroundVerify() {
    let hasSessionId = false;

    try {
        const cachedUserStr = localStorage.getItem('app_user_cache');
        const cachedUser = cachedUserStr ? JSON.parse(cachedUserStr) : {};
        hasSessionId = typeof cachedUser.sessionId === 'string' && cachedUser.sessionId.trim() !== '';
        const profile = await liff.getProfile();

        // User จาก cache รุ่นเก่าไม่มี sessionId จึงต้องสร้าง session ใหม่ให้สำเร็จ
        // ห้าม fallback ไป verify_session แบบไม่มี sessionId เพราะ backend จะรองรับ
        // legacy request และยอมให้เข้าใช้งานต่อโดยไม่มี ActiveSessions record.
        if (!hasSessionId) {
            const os = (typeof liff !== 'undefined' && typeof liff.getOS === 'function') ? liff.getOS() : 'web';
            const isInClient = (typeof liff !== 'undefined' && typeof liff.isInClient === 'function') ? liff.isInClient() : false;
            const res = await fetch(AUTH_CONFIG.gasUrl, {
                method: 'POST',
                body: JSON.stringify({
                    actionType: 'login_auth',
                    action: 'login_auth',
                    userId: profile.userId,
                    displayName: profile.displayName,
                    pictureUrl: profile.pictureUrl,
                    os: os,
                    isInClient: isInClient,
                    userAgentRaw: navigator.userAgent || ''
                })
            });

            if (!res.ok) {
                throw new Error(`Session migration request failed: HTTP ${res.status}`);
            }

            const r = await parseJsonResponseSafe_(res, 'login_auth');
            const newSessionId = typeof r.sessionId === 'string' ? r.sessionId.trim() : '';
            if ((r.success || r.ok) && newSessionId) {
                cachedUser.sessionId = newSessionId;
                cachedUser.role = r.role || cachedUser.role;
                localStorage.setItem('app_user_cache', JSON.stringify(cachedUser));
                if (typeof window.setLastVerifiedAt === 'function') {
                    window.setLastVerifiedAt(Date.now());
                }
                return true;
            }

            console.warn('Session migration failed:', r.reason || 'sessionId missing');
            clearLocalSessionAndRedirect_('ไม่สามารถสร้างข้อมูลอุปกรณ์ของคุณได้ กรุณาเข้าสู่ระบบใหม่');
            return false;
        }

        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'verify_session',
                action: 'verify_session',
                userId: profile.userId,
                sessionId: cachedUser.sessionId
            })
        });
        
        const result = await parseJsonResponseSafe_(response, 'verify_session');

        const isOk = result.success || result.ok;
        if (!isOk) {
            let msg = result.needFollow ? 
                'กรุณาเพิ่มเพื่อน LINE Official Account อีกครั้งเพื่อใช้งานต่อ' : 
                'สิทธิ์การเข้าใช้งานของคุณถูกยกเลิกแล้ว';
            
            if (result.reason === 'SESSION_LOGGED_OUT') {
                msg = 'คุณถูกออกจากระบบจากอุปกรณ์นี้ กรุณาเข้าสู่ระบบใหม่';
            } else if (result.reason === 'SESSION_NOT_FOUND') {
                msg = 'เซสชันหมดอายุหรือไม่พบข้อมูล กรุณาเข้าสู่ระบบใหม่';
            }

            clearLocalSessionAndRedirect_(msg);
            return false;
        } else {
            if (typeof window.setLastVerifiedAt === 'function') {
                window.setLastVerifiedAt(Date.now());
            }
            return true;
        }
    } catch (error) {
        // Network error ของ session ที่มีอยู่แล้วไม่ควรเตะผู้ใช้ออกทันที
        // แต่ cache เก่าที่ไม่มี sessionId ต้อง login ใหม่ เพื่อไม่ให้ใช้งานแบบไร้ session.
        console.warn('Background verify error', error);
        if (!hasSessionId) {
            clearLocalSessionAndRedirect_('ไม่สามารถสร้างข้อมูลอุปกรณ์ของคุณได้ กรุณาเข้าสู่ระบบใหม่');
        }
        return false;
    }
}

// Cache-busting token สำหรับไฟล์ asset ของเราเอง (ไม่ใช้กับ CDN ภายนอก)
// ลำดับการเลือกค่า:
//   1) window.__APP_VERSION ที่ index.html ดึงจาก version.json มาให้ตอน bootstrap (แหล่งความจริงเดียว)
//   2) ?appVersion=... ที่ updateAppToLatestVersion() เติมตอนสั่งอัปเดต (เผื่อกรณี edge case)
//   3) timestamp วันนี้ กันไว้เผื่อ (1) และ (2) ไม่มีค่าจริงๆ
function getAssetCacheBuster_() {
    if (window.__APP_VERSION) return window.__APP_VERSION;
    const params = new URLSearchParams(window.location.search);
    return params.get('appVersion') || new Date().toISOString().slice(0, 10);
}

function withCacheBuster_(href) {
    // ไม่แตะ URL ของ CDN ภายนอก (http/https เต็มรูปแบบ) เติมเฉพาะไฟล์ในโปรเจกต์ตัวเอง
    if (/^https?:\/\//i.test(href)) return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}v=${encodeURIComponent(getAssetCacheBuster_())}`;
}

// Dynamic Loader แบบเรียงลำดับ
async function loadAppAssets() {
    const cssPromises = APP_ASSETS.css.map(href => {
        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = withCacheBuster_(href);
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
        });
    });
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

// ---------------------------------------------------------------------------
// จัดการ UI โปรไฟล์ผู้ใช้ (ดึงข้อมูลจาก Cache ที่บันทึกไว้ตอน Login)
// ---------------------------------------------------------------------------
function initProfileUI() {
    const cachedUserStr = localStorage.getItem('app_user_cache');
    if (!cachedUserStr) return;
    const user = JSON.parse(cachedUserStr);

    // ดึง Elements
    const profileImg = document.getElementById('userProfileImg');
    const tooltip = document.getElementById('userTooltip');
    const dropdownName = document.getElementById('userDropdownName');
    const modalUserName = document.getElementById('logoutModalUserName');

    // ใส่ข้อมูลผู้ใช้ (รูป และ ชื่อ)
    if (profileImg && user.pictureUrl) profileImg.src = user.pictureUrl;
    if (tooltip) tooltip.innerText = user.displayName;
    if (dropdownName) dropdownName.innerText = user.displayName;
    if (modalUserName) modalUserName.innerText = user.displayName;

    // ป้องกันการผูก Event Listener ซ้ำ (กรณีถูกเรียกหลายรอบ)
    if (window.__profileEventsBound) return;
    window.__profileEventsBound = true;

    const profileArea = document.getElementById('userProfileArea');
    const dropdown = document.getElementById('userDropdown');
    const btnProfileRefresh = document.getElementById('btnProfileRefresh');
    const btnProfileLogout = document.getElementById('btnProfileLogout');
    const logoutModal = document.getElementById('logoutConfirmModal');
    const btnCancelLogout = document.getElementById('btnCancelLogout');
    const btnConfirmLogout = document.getElementById('btnConfirmLogout');

    // คลิกเพื่อเปิด/ปิดเมนู Dropdown
    if (profileArea && dropdown) {
        profileArea.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('is-active');

            if (tooltip) {
                tooltip.style.display = dropdown.classList.contains('is-active') ? 'none' : '';
            }
        });

        profileArea.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = '';
        });
    }

    document.addEventListener('click', (e) => {
        if (dropdown && dropdown.classList.contains('is-active') && profileArea && !profileArea.contains(e.target)) {
            dropdown.classList.remove('is-active');
        }
    });

    const btnMySessionInfo = document.getElementById('btnMySessionInfo');
    if (btnMySessionInfo) {
        btnMySessionInfo.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            if (typeof window.openSessionInfoModal === 'function') {
                window.openSessionInfoModal();
            }
        });
    }

    if (btnProfileRefresh) {
        btnProfileRefresh.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            const mainRefreshBtn = document.getElementById('btnForceRefresh');
            if (mainRefreshBtn) mainRefreshBtn.click();
        });
    }

    // ปุ่ม Logout ในเมนู (เปิด Popup)
    if (btnProfileLogout) {
        btnProfileLogout.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            logoutModal.classList.remove('is-hidden');
        });
    }

    // กดยกเลิกใน Popup (ปิด Popup)
    if (btnCancelLogout) {
        btnCancelLogout.addEventListener('click', () => {
            logoutModal.classList.add('is-hidden');
        });
    }

    // กดยืนยันใน Popup (เคลียร์ข้อมูลและกลับไป Login)
    if (btnConfirmLogout) {
        btnConfirmLogout.addEventListener('click', async () => {
            btnConfirmLogout.disabled = true;
            const didLogout = await logoutCurrentSession_();
            if (!didLogout) btnConfirmLogout.disabled = false;
        });
    }
}

// การแสดงผลหน้าต่างๆ
function showApp() {
    authCompleted = true; 

    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.remove('is-hidden');
    ui.app.style.display = 'block';

    initProfileUI();

    if (typeof window.initDashboardApp === 'function') {
        window.initDashboardApp();
    } else {
        console.error('window.initDashboardApp ไม่พร้อมใช้งาน (data-service.js อาจโหลดไม่สำเร็จ)');
    }
}

function showLogin() {
    if (loginInProgress || authCompleted) {
        return;
    }

    ui.splash.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.login.classList.remove('is-hidden');
}

function showError(reasonText) {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.error.classList.remove('is-hidden');
    ui.errorReason.innerText = reasonText;
}

function showFollowPrompt(reasonText) {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    if (ui.follow) {
        ui.follow.classList.remove('is-hidden');
        if (ui.followReason && reasonText) {
            ui.followReason.innerText = reasonText;
        }
    }
}

// เริ่มการทำงานเมื่อโหลดหน้าเสร็จ
// หมายเหตุ: ตอนนี้ auth.js ถูกโหลดแบบ dynamic (รอ fetch version.json ก่อน)
// ทำให้ DOMContentLoaded อาจยิงไปแล้วก่อนโค้ดตรงนี้จะรัน ถ้ารอ event เฉยๆ initApp() จะไม่ถูกเรียกเลย
// จึงต้องเช็ค document.readyState ก่อน ถ้า DOM พร้อมแล้วให้เรียก initApp() ทันที
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

