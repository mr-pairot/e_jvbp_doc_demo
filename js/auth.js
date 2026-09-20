// js/auth.js
// ระบบสารบรรณอิเล็กทรอนิกส์ - ปรับปรุง Authentication แบบ Fast-Boot & Dual Storage

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo 
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec'
    //Url: https://script.google.com/home/projects/1pZbca-IQ9peOsYBflHbdq1L4xTmHQAHQhY2hPA93skMRk9Dg5KePNZUU/edit
};

// ---------------------------------------------------------------------------
// Guest Mode Configuration
// กำหนดวันและเวลาสิ้นสุด Guest Mode (1 ตุลาคม 2569 เวลา 12:00 น.)
// ---------------------------------------------------------------------------
const GUEST_CONFIG = {
    expiryDate: window.__GUEST_EXPIRY_DATE || '2026-10-01T12:00:00+07:00',
    guestName: 'Guest',
    guestAvatar: 'img/guest.svg',
    guestRole: 'Guest'
};

const REGISTRATION_PENDING_KEY = 'bpnp_reg_pending';
const REGISTRATION_STATUS_KEY = 'bpnp_reg_status'; // 'pending' | 'active'

function isGuestModeValid() {
    if (!GUEST_CONFIG.expiryDate) return false;
    const expiryTime = new Date(GUEST_CONFIG.expiryDate).getTime();
    return Date.now() < expiryTime;
}

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
// State Guards
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

// ---------------------------------------------------------------------------
// 1. Dual Storage (Cookie + LocalStorage) Helpers
// ---------------------------------------------------------------------------
function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((acc, part) => {
        const [k, v] = part.split('=');
        return k === name ? decodeURIComponent(v) : acc;
    }, null);
}

function clearCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// รวมการอ่าน-เขียน Cache ไว้ที่เดียว
function getCachedUser() {
    let userStr = localStorage.getItem('app_user_cache');
    let cachedObj = userStr ? JSON.parse(userStr) : null;
    
    // ตรวจสอบ Cookie เผื่อ LocalStorage ถูกเคลียร์โดย OS (ปัญหา PWA ใน iOS)
    let cookieUserId = getCookie('BPNP_DOC_USER_ID');
    let cookieSessionId = getCookie('BPNP_DOC_SESSION_ID');
    
    if (cachedObj && (cachedObj.sessionId || cachedObj.isGuest)) {
        return cachedObj;
    } else if (cookieUserId && cookieSessionId) {
        return { userId: cookieUserId, sessionId: cookieSessionId, role: 'User' };
    }
    return null;
}

function setCachedUser(data) {
    localStorage.setItem('app_user_cache', JSON.stringify(data));
    if (data.userId) setCookie('BPNP_DOC_USER_ID', data.userId);
    if (data.sessionId) setCookie('BPNP_DOC_SESSION_ID', data.sessionId);
}

function clearCachedUser() {
    localStorage.removeItem('app_user_cache');
    clearCookie('BPNP_DOC_USER_ID');
    clearCookie('BPNP_DOC_SESSION_ID');
}

// ---------------------------------------------------------------------------
// 2. Event Listeners 
// ---------------------------------------------------------------------------
ui.loginBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    if (loginInProgress || (typeof liff !== 'undefined' && liff.isLoggedIn())) return;

    loginInProgress = true;
    try { sessionStorage.setItem(LOGIN_PENDING_KEY, '1'); } catch (err) {}

    // ปลดล็อคปุ่ม UI - เอา setLoginButtonLoading(true) ออกเพื่อแก้ปัญหาค้าง 
    // ยิง liff.login() ทันที
    liff.login(); 
});

ui.logoutBtn.addEventListener('click', async () => {
    if (ui.logoutBtn) ui.logoutBtn.disabled = true;
    const didLogout = await logoutCurrentSession_();
    if (!didLogout && ui.logoutBtn) ui.logoutBtn.disabled = false;
});

if (ui.recheckFriendBtn) {
    ui.recheckFriendBtn.addEventListener('click', () => window.location.reload());
}

// --- PWA Visibility Change Fix ---
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        if (loginInProgress) {
            loginInProgress = false;
            clearLoginPending();
        }
        
        // ถ้าล็อกอินสำเร็จจากหน้าต่าง Chrome ไปแล้ว ให้โหลดหน้า PWA เข้าแอปทันที
        const cachedUser = getCachedUser();
        if (cachedUser && cachedUser.sessionId && !authCompleted) {
            window.location.reload();
        }
    }
});

window.addEventListener("pageshow", (e) => {
    if (e.persisted && loginInProgress) {
        loginInProgress = false;
        clearLoginPending();
    }
});

function isLoginPending() {
    try { return sessionStorage.getItem(LOGIN_PENDING_KEY) === '1'; } catch (e) { return false; }
}

function clearLoginPending() {
    try { sessionStorage.removeItem(LOGIN_PENDING_KEY); } catch (e) {}
}

async function checkFriendshipClientSide() {
    try { return (await liff.getFriendship()).friendFlag; } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// 3. Initialization Flow (Cache-First Fast Boot & Guest Mode)
// ---------------------------------------------------------------------------
async function initApp() {
    if (authInitializing) return;
    authInitializing = true;

    try {
        const cachedUser = getCachedUser();

        // 1. ถ้าเป็น Registered User (มี sessionId และไม่ใช่ Guest) -> Fast Boot
        if (cachedUser && cachedUser.sessionId && !cachedUser.isGuest) {
            console.log('Cache Hit: Loading App immediately for session:', cachedUser.sessionId);
            
            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
            await loadAppAssets();
            showApp();

            // ตรวจสอบสิทธิ์ย้อนหลัง และกำหนดค่า LIFF ไว้เบื้องหลัง
            if (typeof liff !== 'undefined') {
                await liff.init({ liffId: AUTH_CONFIG.liffId }).catch(console.warn);
                await backgroundVerify(cachedUser);
            }
            return;
        }

        // 2. ตรวจสอบว่ากำลังกลับมาจากการ Login LINE เพื่อลงทะเบียนหรือไม่
        const isRegPending = sessionStorage.getItem(REGISTRATION_PENDING_KEY) === '1';
        if (isRegPending) {
            sessionStorage.removeItem(REGISTRATION_PENDING_KEY);
            ui.splashStatus.innerText = 'กำลังเชื่อมต่อ LINE เพื่อลงทะเบียน...';
            try {
                if (typeof liff !== 'undefined') {
                    await liff.init({ liffId: AUTH_CONFIG.liffId });
                    if (liff.isLoggedIn()) {
                        const profile = await liff.getProfile();
                        window.__pendingLineProfile = profile;

                        if (isGuestModeValid()) {
                            const guestUser = {
                                userId: 'guest',
                                displayName: GUEST_CONFIG.guestName,
                                pictureUrl: GUEST_CONFIG.guestAvatar,
                                role: GUEST_CONFIG.guestRole,
                                isGuest: true,
                                timestamp: Date.now()
                            };
                            setCachedUser(guestUser);

                            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
                            await loadAppAssets();
                            showApp();
                            openRegisterModal(profile);
                            return;
                        }
                    }
                }
            } catch (regErr) {
                console.warn('Liff reg init error:', regErr);
            }
        }

        // 3. ตรวจสอบ Guest Mode (หากยังไม่หมดอายุตาม GUEST_CONFIG.expiryDate)
        if (isGuestModeValid()) {
            console.log('Guest Mode Active: Entering without LINE login');
            const guestUser = (cachedUser && cachedUser.isGuest) ? cachedUser : {
                userId: 'guest',
                displayName: GUEST_CONFIG.guestName,
                pictureUrl: GUEST_CONFIG.guestAvatar,
                role: GUEST_CONFIG.guestRole,
                sessionId: '',
                isGuest: true,
                timestamp: Date.now()
            };
            setCachedUser(guestUser);

            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
            await loadAppAssets();
            showApp();

            // กำหนดค่า LIFF ไว้เบื้องหลังเพื่อพร้อมสำหรับการลงทะเบียน
            if (typeof liff !== 'undefined') {
                liff.init({ liffId: AUTH_CONFIG.liffId }).catch(console.warn);
            }
            return;
        }

        // 4. หากหมดอายุ Guest Mode: ล้างแคช Guest ออก และเข้าสู่การบังคับ Login
        if (cachedUser && cachedUser.isGuest) {
            clearCachedUser();
        }

        ui.splashStatus.innerText = 'กำลังเตรียมระบบ...';
        await liff.init({ liffId: AUTH_CONFIG.liffId });

        if (!liff.isLoggedIn()) {
            if (isLoginPending()) {
                clearLoginPending();
                loginInProgress = false;
            }
            showLogin();
        } else {
            if (isLoginPending()) clearLoginPending();
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

// ---------------------------------------------------------------------------
// 4. Auth Verifications
// ---------------------------------------------------------------------------
async function parseJsonResponseSafe_(response, contextLabel) {
    const rawText = await response.text();
    try {
        return JSON.parse(rawText);
    } catch (e) {
        console.error(`[${contextLabel}] Backend error:`, rawText.slice(0, 200));
        throw new Error(`${contextLabel}: backend ส่งข้อมูลที่ไม่ใช่ JSON กลับมา`);
    }
}

async function verifyWithBackend(profile) {
    try {
        const os = (typeof liff !== 'undefined' && typeof liff.getOS === 'function') ? liff.getOS() : 'web';
        const isInClient = (typeof liff !== 'undefined' && typeof liff.isInClient === 'function') ? liff.isInClient() : false;

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
                userAgentRaw: navigator.userAgent || ''
            })
        });

        const result = await parseJsonResponseSafe_(response, 'login_auth');
        
        if (result.success || result.ok) {
            setCachedUser({
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                role: result.role,
                sessionId: result.sessionId || '',
                timestamp: new Date().getTime()
            });

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

async function backgroundVerify(cachedUser = null) {
    try {
        const user = cachedUser || getCachedUser();
        if (!user || !user.sessionId || user.isGuest) return false;

        // ดึง userId จาก LIFF ก่อนถ้าทำได้ (ถ้าแอปไม่ได้ล็อคอิน LIFF แต่มี cookie จะใช้ userId จาก cookie)
        let userId = user.userId;
        if (liff && liff.isLoggedIn()) {
            const profile = await liff.getProfile().catch(() => null);
            if (profile) userId = profile.userId;
        }

        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'verify_session',
                action: 'verify_session',
                userId: userId,
                sessionId: user.sessionId
            })
        });
        
        const result = await parseJsonResponseSafe_(response, 'verify_session');

        if (!(result.success || result.ok)) {
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
            if (typeof window.setLastVerifiedAt === 'function') window.setLastVerifiedAt(Date.now());
            return true;
        }
    } catch (error) {
        console.warn('Background verify error', error);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 5. Logout & Cache Clearing
// ---------------------------------------------------------------------------
function clearLocalSessionAndRedirect_(message) {
    clearCachedUser();
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
    if (message) alert(message);
    window.location.reload();
}
window.clearLocalSessionAndRedirect_ = clearLocalSessionAndRedirect_;

async function logoutCurrentSession_() {
    if (logoutInProgress) return false;
    logoutInProgress = true;

    // UI Loading for Logout
    const logoutModal = document.getElementById('logoutConfirmModal');
    if (logoutModal) logoutModal.classList.add('is-hidden');
    
    if (ui.app) {
        ui.app.classList.add('is-hidden');
        ui.app.style.display = 'none';
    }

    if (ui.splash) {
        ui.splash.classList.remove('is-hidden');
        ui.splash.style.display = 'flex';
        ui.splash.style.opacity = '1';
        ui.splash.style.visibility = 'visible'; 
    }
    
    if (ui.splashStatus) {
        ui.splashStatus.innerText = 'กำลังออกจากระบบ...';
        ui.splashStatus.style.color = '#f97316';
        ui.splashStatus.style.fontWeight = '600'; 
    }
    
    const splashRings = document.getElementById('splashRingsBg');
    if (splashRings) {
        splashRings.style.display = 'block';
        splashRings.style.opacity = '1';
    }
    
    if (typeof window.startMagicRingsBg === 'function') window.startMagicRingsBg();

    const splashProgressWrap = document.getElementById('splashProgressWrap');
    if (splashProgressWrap) splashProgressWrap.style.display = 'none';

    try {
        const cachedUser = getCachedUser();
        
        if (cachedUser && cachedUser.sessionId) {
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

            if (!response.ok) throw new Error(`Logout request failed`);
            const result = await parseJsonResponseSafe_(response, 'logout_session');
            
            if (!result.success && !result.ok) {
                if (!['SESSION_NOT_FOUND', 'SESSION_LOGGED_OUT', 'REQUESTER_SESSION_INVALID'].includes(result.reason)) {
                    throw new Error(result.reason || 'Backend rejected logout');
                }
            }
        }

        if (typeof liff !== 'undefined' && liff.isLoggedIn()) liff.logout();
        clearCachedUser();
        
        window.location.reload();
        return true;
        
    } catch (error) {
        console.error('Logout error:', error);
        alert('ไม่สามารถบันทึกการออกจากระบบได้ แต่ข้อมูลในเครื่องถูกลบแล้ว');
        clearCachedUser();
        window.location.reload();
        return false;
    } finally {
        logoutInProgress = false;
    }
}
window.logoutCurrentSession_ = logoutCurrentSession_;

// ---------------------------------------------------------------------------
// 6. Asset Loading & UI Render
// ---------------------------------------------------------------------------
function getAssetCacheBuster_() {
    if (window.__APP_VERSION) return window.__APP_VERSION;
    const params = new URLSearchParams(window.location.search);
    return params.get('appVersion') || new Date().toISOString().slice(0, 10);
}

function withCacheBuster_(href) {
    if (/^https?:\/\//i.test(href)) return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}v=${encodeURIComponent(getAssetCacheBuster_())}`;
}

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

function initProfileUI() {
    const cachedUser = getCachedUser();
    if (!cachedUser) return;

    const isGuest = !cachedUser.sessionId || cachedUser.isGuest;

    const profileImg = document.getElementById('userProfileImg');
    const tooltip = document.getElementById('userTooltip');
    const dropdownName = document.getElementById('userDropdownName');
    const modalUserName = document.getElementById('logoutModalUserName');
    const btnMySessionInfo = document.getElementById('btnMySessionInfo');
    const btnProfileRefresh = document.getElementById('btnProfileRefresh');
    const btnProfileLogout = document.getElementById('btnProfileLogout');
    const btnOpenRegisterModal = document.getElementById('btnOpenRegisterModal');
    const registerSubText = document.getElementById('registerSubText');

    if (isGuest) {
        // --- สถานะ Guest Mode ---
        if (profileImg) profileImg.src = GUEST_CONFIG.guestAvatar;
        if (tooltip) tooltip.innerText = GUEST_CONFIG.guestName;
        if (dropdownName) dropdownName.innerText = GUEST_CONFIG.guestName;
        if (modalUserName) modalUserName.innerText = GUEST_CONFIG.guestName;

        // เมนูของ Guest: แสดงเฉพาะ "รีเฟรชข้อมูล" และ "ลงทะเบียนเข้าใช้" (ซ่อนที่เหลือ)
        if (btnMySessionInfo) btnMySessionInfo.style.display = 'none';
        if (btnProfileLogout) btnProfileLogout.style.display = 'none';
        if (btnProfileRefresh) btnProfileRefresh.style.display = '';

        if (btnOpenRegisterModal) {
            btnOpenRegisterModal.classList.remove('is-hidden');
            btnOpenRegisterModal.style.display = 'flex';
        }

        // ตรวจสอบสถานะว่าลงทะเบียนแล้วและรออนุมัติหรือไม่
        const regStatus = localStorage.getItem(REGISTRATION_STATUS_KEY);
        if (regStatus === 'pending') {
            if (registerSubText) registerSubText.style.display = 'inline-block';
        } else {
            if (registerSubText) registerSubText.style.display = 'none';
        }
    } else {
        // --- สถานะ Registered User ---
        if (profileImg && cachedUser.pictureUrl) profileImg.src = cachedUser.pictureUrl;
        if (tooltip && cachedUser.displayName) tooltip.innerText = cachedUser.displayName;
        if (dropdownName && cachedUser.displayName) dropdownName.innerText = cachedUser.displayName;
        if (modalUserName && cachedUser.displayName) modalUserName.innerText = cachedUser.displayName;

        // เมนูเดิมแสดงครบทั้งหมด และซ่อนปุ่มลงทะเบียน
        if (btnMySessionInfo) btnMySessionInfo.style.display = '';
        if (btnProfileLogout) btnProfileLogout.style.display = '';
        if (btnProfileRefresh) btnProfileRefresh.style.display = '';
        if (btnOpenRegisterModal) {
            btnOpenRegisterModal.classList.add('is-hidden');
            btnOpenRegisterModal.style.display = 'none';
        }
    }

    if (window.__profileEventsBound) return;
    window.__profileEventsBound = true;

    const profileArea = document.getElementById('userProfileArea');
    const dropdown = document.getElementById('userDropdown');
    const logoutModal = document.getElementById('logoutConfirmModal');
    const btnCancelLogout = document.getElementById('btnCancelLogout');
    const btnConfirmLogout = document.getElementById('btnConfirmLogout');

    if (profileArea && dropdown) {
        profileArea.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('is-active');
            if (tooltip) tooltip.style.display = dropdown.classList.contains('is-active') ? 'none' : '';
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

    if (btnMySessionInfo) {
        btnMySessionInfo.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            if (typeof window.openSessionInfoModal === 'function') window.openSessionInfoModal();
        });
    }

    if (btnProfileRefresh) {
        btnProfileRefresh.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            const mainRefreshBtn = document.getElementById('btnForceRefresh');
            if (mainRefreshBtn) mainRefreshBtn.click();
        });
    }

    if (btnOpenRegisterModal) {
        btnOpenRegisterModal.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            const regStatus = localStorage.getItem(REGISTRATION_STATUS_KEY);
            if (regStatus === 'pending') {
                const rawInfo = localStorage.getItem('bpnp_reg_info');
                let infoHtml = '';
                if (rawInfo) {
                    try {
                        const info = JSON.parse(rawInfo);
                        const safeNick = (info.nickname || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        const safeOrg = (info.org || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        infoHtml = `<div style="text-align:left; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; margin:12px 0; font-size:13px; line-height:1.6;">` +
                                   `<div><b>ชื่อที่ลงทะเบียน:</b> ${safeNick}</div>` +
                                   `<div><b>หน่วยงาน:</b> ${safeOrg}</div>` +
                                   `</div>`;
                    } catch (e) {}
                }
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'info',
                        title: 'อยู่ระหว่างรอการอนุมัติ',
                        html: `คุณได้ส่งข้อมูลลงทะเบียนเข้าใช้งานระบบแล้ว${infoHtml}<span style="font-size:13px; color:#64748b;">กรุณารอผู้ดูแลระบบตรวจสอบและอนุมัติสิทธิ์การเข้าใช้งาน</span>`,
                        confirmButtonColor: '#0d6efd',
                        confirmButtonText: 'รับทราบ'
                    });
                } else {
                    alert('คุณได้ลงทะเบียนเข้าใช้ระบบเรียบร้อยแล้ว กรุณารอผู้ดูแลระบบตรวจสอบและอนุมัติสิทธิ์');
                }
            } else {
                openRegisterModal();
            }
        });
    }

    if (btnProfileLogout) {
        btnProfileLogout.addEventListener('click', () => {
            dropdown.classList.remove('is-active');
            logoutModal.classList.remove('is-hidden');
        });
    }

    if (btnCancelLogout) btnCancelLogout.addEventListener('click', () => logoutModal.classList.add('is-hidden'));
    if (btnConfirmLogout) {
        btnConfirmLogout.addEventListener('click', async () => {
            btnConfirmLogout.disabled = true;
            const didLogout = await logoutCurrentSession_();
            if (!didLogout) btnConfirmLogout.disabled = false;
        });
    }
}

// ---------------------------------------------------------------------------
// 5.1 Registration Modal Management
// ---------------------------------------------------------------------------
let currentRegisterProfile = null;
let __registerModalEventsBound = false;

function openRegisterModal(lineProfile = null) {
    const modal = document.getElementById('registerModal');
    if (!modal) return;

    setupRegisterModalEvents();

    const stepLineConnect = document.getElementById('regStepLineConnect');
    const stepForm = document.getElementById('regStepForm');
    const avatar = document.getElementById('regLineAvatar');
    const nameSpan = document.getElementById('regLineDisplayName');
    const nicknameInput = document.getElementById('regNicknameInput');

    const profile = lineProfile || window.__pendingLineProfile;

    if (profile && profile.userId) {
        currentRegisterProfile = profile;
        if (avatar) avatar.src = profile.pictureUrl || 'img/doc-icon.svg';
        if (nameSpan) nameSpan.innerText = profile.displayName || '-';

        if (stepLineConnect) stepLineConnect.classList.add('is-hidden');
        if (stepForm) stepForm.classList.remove('is-hidden');

        if (nicknameInput && !nicknameInput.value && profile.displayName) {
            nicknameInput.value = profile.displayName;
        }
        setTimeout(() => {
            if (nicknameInput) nicknameInput.focus();
        }, 150);
    } else {
        currentRegisterProfile = null;
        if (stepLineConnect) stepLineConnect.classList.remove('is-hidden');
        if (stepForm) stepForm.classList.add('is-hidden');
    }

    validateRegisterForm();
    modal.classList.remove('is-hidden');
}
window.openRegisterModal = openRegisterModal;

function closeRegisterModal() {
    const modal = document.getElementById('registerModal');
    if (modal) modal.classList.add('is-hidden');
}
window.closeRegisterModal = closeRegisterModal;

function validateRegisterForm() {
    const submitBtn = document.getElementById('btnSubmitRegister');
    const nicknameInput = document.getElementById('regNicknameInput');
    const orgSelect = document.getElementById('regOrgSelect');
    const otherOrgInput = document.getElementById('regOtherOrgInput');

    if (!submitBtn) return;

    const hasProfile = !!currentRegisterProfile && !!currentRegisterProfile.userId;
    const nickname = (nicknameInput ? nicknameInput.value : '').trim();
    const org = (orgSelect ? orgSelect.value : '').trim();
    
    let isOrgValid = false;
    if (org === 'อื่นๆ(ระบุ)') {
        isOrgValid = (otherOrgInput ? otherOrgInput.value.trim() : '').length > 0;
    } else if (org !== '') {
        isOrgValid = true;
    }

    const isValid = hasProfile && nickname.length > 0 && isOrgValid;
    submitBtn.disabled = !isValid;
}

function setupRegisterModalEvents() {
    if (__registerModalEventsBound) return;
    __registerModalEventsBound = true;

    const closeBtn = document.getElementById('btnCloseRegisterModal');
    const cancelBtn = document.getElementById('btnCancelRegister');
    const submitBtn = document.getElementById('btnSubmitRegister');
    const lineConnectBtn = document.getElementById('btnLineConnectForReg');
    const nicknameInput = document.getElementById('regNicknameInput');
    const orgSelect = document.getElementById('regOrgSelect');
    const otherOrgGroup = document.getElementById('regOtherOrgGroup');
    const otherOrgInput = document.getElementById('regOtherOrgInput');

    if (closeBtn) closeBtn.addEventListener('click', closeRegisterModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeRegisterModal);

    if (lineConnectBtn) {
        lineConnectBtn.addEventListener('click', async () => {
            try {
                sessionStorage.setItem(REGISTRATION_PENDING_KEY, '1');
                if (typeof liff === 'undefined') {
                    alert('ไม่พบ LINE LIFF SDK');
                    return;
                }
                if (!liff.isLoggedIn()) {
                    liff.login();
                } else {
                    const profile = await liff.getProfile();
                    openRegisterModal(profile);
                }
            } catch (err) {
                console.error('Line login for reg error:', err);
                alert('เกิดข้อผิดพลาดในการเชื่อมต่อ LINE: ' + (err.message || err));
            }
        });
    }

    if (nicknameInput) {
        nicknameInput.addEventListener('input', validateRegisterForm);
    }

    if (orgSelect) {
        orgSelect.addEventListener('change', () => {
            if (orgSelect.value === 'อื่นๆ(ระบุ)') {
                if (otherOrgGroup) otherOrgGroup.classList.remove('is-hidden');
                if (otherOrgInput) otherOrgInput.focus();
            } else {
                if (otherOrgGroup) otherOrgGroup.classList.add('is-hidden');
            }
            validateRegisterForm();
        });
    }

    if (otherOrgInput) {
        otherOrgInput.addEventListener('input', validateRegisterForm);
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', submitRegistration);
    }
}

async function submitRegistration() {
    const submitBtn = document.getElementById('btnSubmitRegister');
    const nicknameInput = document.getElementById('regNicknameInput');
    const orgSelect = document.getElementById('regOrgSelect');
    const otherOrgInput = document.getElementById('regOtherOrgInput');

    if (!currentRegisterProfile || !currentRegisterProfile.userId) {
        alert('กรุณาเชื่อมต่อบัญชี LINE ก่อนลงทะเบียน');
        return;
    }

    const nickname = (nicknameInput ? nicknameInput.value : '').trim();
    if (!nickname) {
        alert('กรุณากรอกชื่อจริงหรือชื่อเล่น');
        return;
    }

    let finalOrg = (orgSelect ? orgSelect.value : '').trim();
    if (!finalOrg) {
        alert('กรุณาเลือกหน่วยงาน');
        return;
    }
    if (finalOrg === 'อื่นๆ(ระบุ)') {
        finalOrg = (otherOrgInput ? otherOrgInput.value.trim() : '');
        if (!finalOrg) {
            alert('กรุณาระบุชื่อหน่วยงาน');
            return;
        }
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'กำลังส่งข้อมูล...';
    }

    try {
        const payload = {
            actionType: 'register_user',
            userId: currentRegisterProfile.userId,
            displayName: currentRegisterProfile.displayName || '',
            pictureUrl: currentRegisterProfile.pictureUrl || '',
            nickname: nickname,
            organization: finalOrg
        };

        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await parseJsonResponseSafe_(response, 'register_user');

        if (result.success || result.ok) {
            // บันทึกสถานะว่าลงทะเบียนแล้ว รออนุมัติ
            localStorage.setItem(REGISTRATION_STATUS_KEY, result.status === 'Active' ? 'active' : 'pending');
            localStorage.setItem('bpnp_reg_info', JSON.stringify({
                userId: payload.userId,
                displayName: payload.displayName,
                nickname: payload.nickname,
                org: payload.organization,
                registeredAt: new Date().toISOString()
            }));

            closeRegisterModal();

            // แสดงข้อความ "(รออนุมัติ)" ใต้ปุ่มลงทะเบียน
            const registerSubText = document.getElementById('registerSubText');
            if (registerSubText) {
                registerSubText.style.display = 'inline-block';
            }

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'ลงทะเบียนสำเร็จ',
                    text: result.message || 'ข้อมูลของคุณอยู่ระหว่างรอผู้ดูแลระบบตรวจสอบและอนุมัติสิทธิ์',
                    confirmButtonColor: '#0d6efd',
                    confirmButtonText: 'ตกลง'
                });
            } else {
                alert(result.message || 'ลงทะเบียนสำเร็จ กรุณารอผู้ดูแลระบบตรวจสอบและอนุมัติสิทธิ์');
            }
        } else {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'ไม่สามารถลงทะเบียนได้',
                    text: result.message || result.reason || 'เกิดข้อผิดพลาดในการลงทะเบียน',
                    confirmButtonColor: '#0d6efd',
                    confirmButtonText: 'ตกลง'
                });
            } else {
                alert(result.message || result.reason || 'เกิดข้อผิดพลาดในการลงทะเบียน');
            }
        }
    } catch (err) {
        console.error('Submit registration error:', err);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ลงทะเบียน: ' + (err.message || err));
    } finally {
        if (submitBtn) {
            submitBtn.innerText = 'ลงทะเบียน';
            validateRegisterForm();
        }
    }
}

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
        console.error('window.initDashboardApp ไม่พร้อมใช้งาน');
    }
}

function showLogin() {
    if (loginInProgress || authCompleted) return;
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
        if (ui.followReason && reasonText) ui.followReason.innerText = reasonText;
    }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
