// js/auth.js
// ระบบสารบรรณอิเล็กทรอนิกส์ - ปรับปรุง Authentication แบบ Fast-Boot & Dual Storage
//
// [แก้ไขรอบก่อนหน้า] checkBackendAuth_() ถูกห่อด้วย Web Locks API (navigator.locks) เพื่อป้องกัน
// การยิง login_auth ซ้ำซ้อนข้ามแท็บ/หน้าต่างของ origin เดียวกัน — ดูคอมเมนต์ // [FIX]
//
// [แก้ไขรอบก่อนหน้า] เพิ่ม flow ตรวจสอบสถานะการเป็นเพื่อน LINE OA สำหรับผู้ใช้สถานะ NotFound:
//   - Guest Mode มีสิทธิ์เหนือกว่า Follow Page เสมอ (แสดง Follow Page เฉพาะตอน Guest Mode หมดอายุแล้ว)
//   - ถ้ายังไม่เป็นเพื่อน -> บังคับแสดง Follow Page ก่อน
//   - ถ้าเป็นเพื่อนแล้ว -> ให้เป็นไปตามเกณฑ์ผู้ใช้ login LINE แล้ว (เปิด Registration Modal)
//   - เมนู "ลงทะเบียนเข้าใช้" ใน Guest Mode จะสลับเป็นลิงก์เพิ่มเพื่อนถ้ายังไม่เป็นเพื่อน
//   ดูคอมเมนต์ // [เพิ่ม] ทุกจุดที่เกี่ยวข้อง
//
// [แก้ไขรอบนี้] ย้าย showAlert()/showConfirm() มาไว้ที่ไฟล์นี้ (เดิมอยู่ใน config.js)
//   เหตุผล: หน้า Login/Error/Follow Page และ Register Modal (กรณี Guest Mode หมดอายุ
//   ก่อน login สำเร็จ) ยังไม่ได้โหลด config.js (โหลดผ่าน loadAppAssets() ตอน showApp()
//   เท่านั้น) แต่ auth.js โหลดก่อนเสมอไม่ว่าจะอยู่หน้าไหน จึงย้ายมาไว้ที่นี่เพื่อให้
//   เรียกใช้ได้แน่นอนทุกจุด พร้อมแทนที่ alert() เดิมทั้งหมดด้วย showAlert() ที่เลือก
//   icon ให้เหมาะกับบริบท (validation -> warning, ปัญหาระบบ/เครือข่าย -> error,
//   แจ้งข้อมูลทั่วไป -> info) ดูคอมเมนต์ // [เพิ่ม-Alert] ทุกจุดที่เกี่ยวข้อง

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo 
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec'
    //Url: https://script.google.com/home/projects/1pZbca-IQ9peOsYBflHbdq1L4xTmHQAHQhY2hPA93skMRk9Dg5KePNZUU/edit
};

// ---------------------------------------------------------------------------
// [เพิ่ม] LINE OA Add-Friend Link & Friendship Status
// ---------------------------------------------------------------------------
const LINE_OA_ADD_FRIEND_URL = 'https://line.me/R/ti/p/%40520qkrvo';
const LINE_FRIEND_STATUS_KEY = 'bpnp_is_line_friend'; // 'true' | 'false' — เก็บถาวรจนกว่าจะ logout/ล้าง cache ทั้งระบบ

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
        'js/about-popup.js',
        'js/user-notify.js'
    ]
};

// ---------------------------------------------------------------------------
// [เพิ่ม-Alert] Alert / Confirm Helpers (ย้ายมาจาก config.js)
// ---------------------------------------------------------------------------
// ใช้แทน alert()/confirm() ของเบราว์เซอร์ทั้งระบบ ด้วย SweetAlert2 (โหลดแบบไม่มี
// เงื่อนไขใน index.html จึงพร้อมใช้งานตั้งแต่หน้า splash/login/error/follow แล้ว)
// ถ้าโหลด SweetAlert2 ไม่สำเร็จ (เช่น เน็ตหลุด) จะ fallback ไปใช้ alert()/confirm()
// ปกติของเบราว์เซอร์แทน เพื่อไม่ให้ผู้ใช้ไม่เห็นข้อความแจ้งเตือนเลย
async function showAlert(message, icon = 'info', title = 'แจ้งเตือน') {
    if (typeof window.Swal !== "undefined") {
        await window.Swal.fire({
            title: title,
            text: message,
            icon: icon, // 'success', 'error', 'warning', 'info', 'question'
            confirmButtonText: 'ตกลง',
            confirmButtonColor: '#3b82f6',
            heightAuto: false
        });
    } else {
        // Fallback กรณีโหลด SweetAlert ไม่สำเร็จ
        alert(message);
    }
}

async function showConfirm(message, title = 'ยืนยัน', confirmText = 'ตกลง', cancelText = 'ยกเลิก', icon = 'warning') {
    if (typeof window.Swal !== "undefined") {
        const result = await window.Swal.fire({
            title: title,
            text: message,
            icon: icon,
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: cancelText,
            confirmButtonColor: '#dc2626', // สีแดง (ใช้กับ action สำคัญเช่น ออกจากระบบ)
            cancelButtonColor: '#64748b',  // สีเทา
            reverseButtons: true,
            focusCancel: true,
            heightAuto: false
        });
        return result.isConfirmed;
    } else {
        // Fallback กรณีโหลด SweetAlert ไม่สำเร็จ
        return window.confirm(message);
    }
}

// ---------------------------------------------------------------------------
// State Guards
// ---------------------------------------------------------------------------
const LOGIN_PENDING_KEY = 'line_login_pending';

let loginInProgress = false;   
let authInitializing = false;  
let authCompleted = false;     
let logoutInProgress = false;

// --- Auth State Recovery Guards (กัน refreshAuthState / liff.init ทำงานซ้ำซ้อน) ---
let authRefreshInProgress = false;
let liffInitPromise = null;

// ---------------------------------------------------------------------------
// Persistent Pending-Flag Helpers (ใช้ localStorage แทน sessionStorage)
// ---------------------------------------------------------------------------
// เหตุผล: เมื่อ PWA (โดยเฉพาะที่ติดตั้งแบบ Add to Home Screen บน iOS) นำทางออกไปยัง
// โดเมนภายนอก (LINE Login) ระบบปฏิบัติการมักจะ "ฆ่า/รีสตาร์ท" instance ของแอปเดิม
// แล้วเปิดหน้าต่าง/แอปแยกต่างหากเพื่อจัดการ OAuth (พฤติกรรมนี้เกิดจาก OS ไม่ใช่จากโค้ด
// ที่เรียก window.open) เมื่อผู้ใช้กลับมาที่ไอคอนแอปเดิม บางครั้งจึงเป็นการ "เปิดใหม่"
// ทั้งหมด ไม่ใช่แค่ resume แท็บเดิม sessionStorage จะหายไปในกรณีนี้ (ผูกกับ browsing
// context เดิมที่ถูกทำลายไปแล้ว) จึงต้องใช้ localStorage ซึ่งอยู่ระดับ origin แทน
// พร้อมกำกับ timestamp เพื่อไม่ให้ธงค้างอยู่ถาวรหากผู้ใช้เปิดค้างไว้นานผิดปกติ
const PENDING_FLAG_TTL_MS = 15 * 60 * 1000; // 15 นาที

function setPendingFlag_(key) {
    try { localStorage.setItem(key, String(Date.now())); } catch (e) {}
}

function isPendingFlagActive_(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const ts = parseInt(raw, 10);
        if (!ts || (Date.now() - ts) > PENDING_FLAG_TTL_MS) {
            localStorage.removeItem(key);
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

function clearPendingFlag_(key) {
    try { localStorage.removeItem(key); } catch (e) {}
}

// ---------------------------------------------------------------------------
// [เพิ่ม] Friendship Status Helpers (สถานะการเป็นเพื่อน LINE OA)
// ---------------------------------------------------------------------------
function setLineFriendStatus_(isFriend) {
    try { localStorage.setItem(LINE_FRIEND_STATUS_KEY, isFriend ? 'true' : 'false'); } catch (e) {}
}

function getLineFriendStatus_() {
    try {
        return localStorage.getItem(LINE_FRIEND_STATUS_KEY) === 'true';
    } catch (e) {
        return false; // ไม่เคยเช็คมาก่อน หรืออ่านไม่ได้ -> ถือว่ายังไม่เป็นเพื่อน (ค่า default ตามที่ตกลง)
    }
}

function clearLineFriendStatus_() {
    try { localStorage.removeItem(LINE_FRIEND_STATUS_KEY); } catch (e) {}
}

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
    clearLineFriendStatus_(); // [เพิ่ม] ล้างสถานะเพื่อนด้วยเมื่อ logout/ล้าง cache ทั้งระบบ
}

// ---------------------------------------------------------------------------
// 1.1 LIFF Init แบบมีตัวป้องกัน ไม่ให้ liff.init() ถูกเรียกซ้ำจากหลายจุด
// ---------------------------------------------------------------------------
function ensureLiffInit() {
    if (!liffInitPromise) {
        liffInitPromise = liff.init({ liffId: AUTH_CONFIG.liffId }).catch((err) => {
            // ถ้า init ล้มเหลว ให้เคลียร์ promise เพื่อเปิดโอกาสให้ลองใหม่ในครั้งถัดไป
            liffInitPromise = null;
            throw err;
        });
    }
    return liffInitPromise;
}

// ---------------------------------------------------------------------------
// 2. Event Listeners 
// ---------------------------------------------------------------------------
ui.loginBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    if (loginInProgress || (typeof liff !== 'undefined' && liff.isLoggedIn())) return;

    loginInProgress = true;
    setPendingFlag_(LOGIN_PENDING_KEY);

    // ปลดล็อคปุ่ม UI - เอา setLoginButtonLoading(true) ออกเพื่อแก้ปัญหาค้าง 
    // ยิง liff.login() ทันที (โค้ดฝั่งเราไม่เปิด window/tab ใหม่ - liff.login() นำทางในบริบทเดิม
    // หมายเหตุ: บางเบราว์เซอร์/OS อาจเปิดโดเมนภายนอกเป็นหน้าต่างแยกเองโดยอัตโนมัติเมื่อออกนอก
    // scope ของ PWA ที่ติดตั้งไว้ ซึ่งเป็นพฤติกรรมระดับ OS ที่ควบคุมจาก JS ไม่ได้ จึงต้องพึ่ง
    // refreshAuthState() + persistent flag ด้านบนเพื่อกู้สถานะเมื่อกลับมาแทน)
    liff.login(); 
});

ui.logoutBtn.addEventListener('click', async () => {
    if (ui.logoutBtn) ui.logoutBtn.disabled = true;
    const didLogout = await logoutCurrentSession_();
    if (!didLogout && ui.logoutBtn) ui.logoutBtn.disabled = false;
});

// [แก้ไข] ปุ่ม "ตรวจสอบอีกครั้ง" ใน Follow Page — เดิมแค่ reload() เฉยๆ
// เปลี่ยนเป็นเช็คสถานะเพื่อนซ้ำก่อน ถ้ายังไม่เป็นเพื่อนจริง จะแจ้งเตือนแทนการ reload วนไปเรื่อยๆ
if (ui.recheckFriendBtn) {
    ui.recheckFriendBtn.addEventListener('click', async () => {
        const originalText = ui.recheckFriendBtn.innerText;
        ui.recheckFriendBtn.disabled = true;
        ui.recheckFriendBtn.innerText = 'กำลังตรวจสอบ...';
        try {
            await ensureLiffInit();
            const isFriend = await checkAndStoreFriendshipStatus_();
            if (isFriend) {
                window.location.reload();
                return;
            }
            ui.recheckFriendBtn.disabled = false;
            ui.recheckFriendBtn.innerText = originalText;
            // [เพิ่ม-Alert] แจ้งข้อมูลทั่วไป (ยังไม่พบการเพิ่มเพื่อน) -> icon: info
            await showAlert(
                'ยังไม่พบการเพิ่มเพื่อน กรุณากดปุ่ม "เพิ่มเพื่อน LINE OA" แล้วลองตรวจสอบอีกครั้ง',
                'info',
                'ยังไม่พบการเพิ่มเพื่อน'
            );
        } catch (err) {
            console.warn('ตรวจสอบสถานะเพื่อนล้มเหลว:', err);
            // เผื่อ error ไม่คาดคิด ให้ reload กลับไปเริ่ม flow ใหม่ตามพฤติกรรมเดิม
            window.location.reload();
        }
    });
}

// ---------------------------------------------------------------------------
// 2.1 App Resume Detection (PWA กลับมา Active)
// ---------------------------------------------------------------------------
// หลักการ: ไม่ถือว่า "กลับมาที่แอป" = "Login สำเร็จ" เด็ดขาด
// ทุกครั้งที่แอปกลับมา Active ต้องเรียก refreshAuthState() เพื่อตรวจสอบ Auth จริง
// แล้วให้ Auth State เป็นตัวกำหนด UI (ปิด Modal / คง Modal ไว้) ไม่ใช่ตัว Event เอง
function handleAppResume(source) {
    if (loginInProgress) {
        loginInProgress = false;
        clearLoginPending();
    }
    refreshAuthState(source);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handleAppResume('visibilitychange');
});

window.addEventListener('pageshow', (e) => {
    if (e.persisted && loginInProgress) {
        loginInProgress = false;
        clearLoginPending();
    }
    handleAppResume('pageshow');
});

// focus ใช้เป็น fallback เท่านั้น ไม่ใช่ตัวตัดสินใจหลัก (refreshAuthState มี lock กันเรียกซ้ำอยู่แล้ว)
window.addEventListener('focus', () => handleAppResume('focus'));

// --- Cross-Window/Tab Sync ---
// เมื่อ LINE Login ถูกเปิดเป็นหน้าต่าง/แท็บแยกโดย OS (กรณี PWA ติดตั้งแล้วนำทางออกนอก scope)
// หน้าต่างเดิมอาจไม่ได้ถูกซ่อน/ระงับจริง ๆ (visibilitychange/focus จึงไม่ทำงานจนกว่าผู้ใช้จะ
// สลับกลับมาเอง) แต่ localStorage เป็นของ origin เดียวกัน เมื่อหน้าต่างใหม่เขียนค่าลง (เช่น
// Token ของ LIFF เอง หรือ app_user_cache/ธง pending ของเรา) เบราว์เซอร์จะยิง 'storage' event
// ไปยังหน้าต่าง/แท็บอื่น ๆ ของ origin เดียวกันโดยอัตโนมัติ ใช้จุดนี้เป็นอีกช่องทางกระตุ้น
// refreshAuthState() แบบเรียลไทม์ โดยไม่ต้องรอผู้ใช้สลับหน้าต่างเอง
window.addEventListener('storage', (e) => {
    if (!e.key) return; // key เป็น null หมายถึง localStorage.clear() ทั้งหมด ไม่ต้องรีบตอบสนอง
    const isRelevantKey = e.key === 'app_user_cache'
        || e.key === REGISTRATION_PENDING_KEY
        || e.key === LOGIN_PENDING_KEY
        || /liff/i.test(e.key); // LIFF SDK เก็บ access token ของตัวเองด้วย key ที่มีคำว่า liff
    if (isRelevantKey) handleAppResume('storage:' + e.key);
});

function isLoginPending() {
    return isPendingFlagActive_(LOGIN_PENDING_KEY);
}

function clearLoginPending() {
    clearPendingFlag_(LOGIN_PENDING_KEY);
}

async function checkFriendshipClientSide() {
    try { return (await liff.getFriendship()).friendFlag; } catch (e) { return null; }
}

// [เพิ่ม] เช็คสถานะเพื่อน LINE OA แล้วบันทึกผลไว้ใน localStorage
// (ใช้กับทั้ง Follow Page และเมนู "ลงทะเบียนเข้าใช้")
// กรณีเช็คไม่ได้ (error/undefined) ถือว่า "ยังไม่เป็นเพื่อน" ไว้ก่อนเพื่อความปลอดภัย (จุดที่ 2 ที่ตกลงไว้)
async function checkAndStoreFriendshipStatus_() {
    const flag = await checkFriendshipClientSide();
    const isFriend = flag === true;
    setLineFriendStatus_(isFriend);
    return isFriend;
}

// ---------------------------------------------------------------------------
// 2.2 refreshAuthState() — จุดกลางของการ Sync Authentication กับ UI
// ---------------------------------------------------------------------------
// เรียกทุกครั้งที่แอปกลับมา Active (pageshow / visibilitychange / focus)
// มีหน้าที่ตรวจสอบ Auth State จริง แล้วปรับ UI (Registration Modal / Login Page)
// ให้สอดคล้องกับผลลัพธ์นั้นเท่านั้น ไม่ใช้ Event ใด ๆ เป็นตัวตัดสินใจปิด Modal เอง
async function refreshAuthState(reason) {
    if (authRefreshInProgress) return;
    if (authInitializing) return; // กำลัง boot รอบแรกอยู่แล้ว ปล่อยให้ initApp() จัดการเอง
    if (typeof liff === 'undefined') return;

    authRefreshInProgress = true;
    try {
        await ensureLiffInit();

        const isLoggedIn = liff.isLoggedIn();

        // --- กรณี 1: Registration Modal เปิดอยู่ และกำลังรอผลการเชื่อมต่อ LINE (ยังอยู่ Step 1) ---
        const registerModal = document.getElementById('registerModal');
        const isRegModalOpen = registerModal && !registerModal.classList.contains('is-hidden');
        const isWaitingLineConnectInModal = isRegModalOpen && !(currentRegisterProfile && currentRegisterProfile.userId);

        if (isWaitingLineConnectInModal) {
            if (isLoggedIn) {
                const profile = await liff.getProfile().catch(() => null);
                if (profile && profile.userId) {
                    clearPendingFlag_(REGISTRATION_PENDING_KEY);

                    // ตรวจสอบกับ Backend ก่อนเผื่อบัญชีนี้ได้รับอนุมัติ (Active) อยู่แล้ว
                    const authResult = await checkBackendAuth_(profile).catch(() => null);
                    if (authResult && (authResult.success || authResult.ok)) {
                        setCachedUser({
                            userId: profile.userId,
                            displayName: profile.displayName,
                            pictureUrl: profile.pictureUrl,
                            role: authResult.role || 'User',
                            sessionId: authResult.sessionId || '',
                            isGuest: false,
                            timestamp: Date.now()
                        });
                        // Authenticated แล้ว -> ปิด Registration Modal อัตโนมัติ ไม่ต้องรอผู้ใช้กดปิดเอง
                        closeRegisterModal();
                        window.location.reload();
                        return;
                    }

                    // เชื่อมต่อ LINE สำเร็จแล้ว แต่ยังไม่ Active -> เช็คเพื่อนก่อน แล้วค่อยเลื่อนไปฟอร์ม (Step 2)
                    await routeNonActiveAfterLineLogin_(profile, authResult);
                }
            }
            // ยังไม่ได้ Login (ผู้ใช้กดยกเลิก/ปิดหน้าต่าง LINE) -> คง Modal ไว้ที่ Step 1 เหมือนเดิม ไม่ปิดเอง
            return;
        }

        // --- กรณี 2: อยู่ในแอปแล้ว (Registered User) -> ตรวจสอบว่า session ยังใช้ได้อยู่ไหม ---
        if (authCompleted) {
            const cachedUser = getCachedUser();
            if (cachedUser && cachedUser.sessionId && !cachedUser.isGuest) {
                await backgroundVerify(cachedUser);
            }
            return;
        }

        // --- กรณี 3: ยังค้างอยู่หน้า Login หลัก แต่ตรวจพบว่า LINE Login สำเร็จแล้ว (กลับมาจากภายนอก) ---
        const isOnLoginPage = ui.login && !ui.login.classList.contains('is-hidden');
        if (isOnLoginPage && isLoggedIn && !loginInProgress) {
            clearLoginPending();
            await initApp();
        }
    } catch (err) {
        console.warn('refreshAuthState error:', err);
    } finally {
        authRefreshInProgress = false;
    }
}
window.refreshAuthState = refreshAuthState;

// ---------------------------------------------------------------------------
// 3. Initialization Flow (Active User Check -> Guest Mode Fallback)
// ---------------------------------------------------------------------------
function enterGuestMode_() {
    const cachedUser = getCachedUser();
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
}

// ---------------------------------------------------------------------------
// [FIX] checkBackendAuth_() — ป้องกันการยิง login_auth ซ้ำซ้อนข้ามแท็บ/หน้าต่าง
// ---------------------------------------------------------------------------
// ปัญหาเดิม: ฟังก์ชันนี้ถูกเรียกจาก 3 จุด (initApp, refreshAuthState, ปุ่มเชื่อมต่อ LINE
// ตอนลงทะเบียน) หากผู้ใช้กด login แล้ว OS เปิดหน้าต่างแยก (พฤติกรรมที่คอมเมนต์ด้านบน
// อธิบายไว้) ทั้งหน้าต่างเดิมและหน้าต่างใหม่อาจเห็น liff.isLoggedIn() === true พร้อมกัน
// และยิง login_auth เกือบพร้อมกัน ทำให้ backend (Code.gs) สร้าง session ใหม่ 2 อัน
// สำหรับอุปกรณ์เดียวกัน (เห็นเป็น "2 อุปกรณ์" ในหน้าข้อมูลการเข้าใช้งานทั้งที่จริงเป็นเครื่องเดียว)
//
// วิธีแก้: ห่อการเรียก fetch ด้วย Web Locks API (navigator.locks) โดยใช้ชื่อ lock ที่ผูก
// กับ userId เพื่อบังคับให้คำขอ login_auth ของผู้ใช้คนเดียวกันทำงานเรียงลำดับกัน (ไม่บล็อก
// ผู้ใช้คนอื่น) นี่เป็นการป้องกันชั้นเสริมฝั่ง client เท่านั้น — ตัวป้องกันหลักที่แท้จริง
// (idempotency) อยู่ที่ handleLoginAuth() + findRecentActiveSession_() ใน Code.gs
async function checkBackendAuth_(profile) {
    const os = (typeof liff !== 'undefined' && typeof liff.getOS === 'function') ? liff.getOS() : 'web';
    const isInClient = (typeof liff !== 'undefined' && typeof liff.isInClient === 'function') ? liff.isInClient() : false;

    const doFetch = async () => {
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

        return await parseJsonResponseSafe_(response, 'login_auth');
    };

    // ตั้งชื่อ lock ให้ผูกกับ userId เพื่อไม่ให้ผู้ใช้คนละคนบล็อกกันเอง
    const lockName = 'bpnp_login_auth_lock_' + String(profile.userId);

    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        try {
            return await navigator.locks.request(lockName, doFetch);
        } catch (lockErr) {
            // ถ้า Web Locks ทำงานผิดพลาดโดยไม่คาดคิด ให้ fallback ไปยิง fetch ตรงๆ
            // ดีกว่าทำให้ login ใช้งานไม่ได้เลย
            console.warn('navigator.locks error, fallback to direct fetch:', lockErr);
            return await doFetch();
        }
    }

    // Fallback สำหรับเบราว์เซอร์ที่ไม่รองรับ Web Locks API (เช่น Safari รุ่นเก่า)
    return await doFetch();
}

// ---------------------------------------------------------------------------
// [เพิ่ม-Login] จุดตัดสินใจกลางหลัง login LINE สำเร็จ แต่ backend ยังไม่ตอบ Active
// ---------------------------------------------------------------------------
// ลำดับที่ถูกต้อง: login LINE -> เช็ค backend (Active? เข้าระบบเลย) -> ถ้ายังไม่ Active
// ค่อยเช็คสถานะเพื่อน (เชื่อถือได้แล้วเพราะ login LIFF แล้ว) ->
//   - ยังไม่เป็นเพื่อน: Guest Mode ยังไม่หมดอายุ -> popup ชวนเพิ่มเพื่อน (คงอยู่ในแอป)
//                       Guest Mode หมดอายุ       -> Follow Page
//   - เป็นเพื่อนแล้ว: เปิดฟอร์มลงทะเบียน Step 2
// ข้ามการเช็คเพื่อนถ้า status === 'Pending' (เคยลงทะเบียนแล้ว รออนุมัติ)
// คืน true ถ้าเปิดฟอร์มลงทะเบียน, false ถ้าถูกกันไว้ที่ขั้นเพิ่มเพื่อน
async function routeNonActiveAfterLineLogin_(profile, authResult) {
    const isPendingApproval = !!(authResult && authResult.status === 'Pending');

    if (!isPendingApproval) {
        let isFriend = false;
        if (!(authResult && authResult.needFollow)) {
            isFriend = await checkAndStoreFriendshipStatus_();
        } else {
            setLineFriendStatus_(false); // backend แจ้งชัดเจนว่ายังไม่เป็นเพื่อน
        }

        if (!isFriend) {
            currentRegisterProfile = null;
            window.__pendingLineProfile = null;
            clearPendingFlag_(REGISTRATION_PENDING_KEY);
            closeRegisterModal();

            if (isGuestModeValid()) {
                await promptAddFriendInGuest_();
            } else {
                showFollowPrompt('เพื่อใช้งานระบบ กรุณาเพิ่มเพื่อนบัญชีทางการก่อน แล้วกดตรวจสอบอีกครั้ง');
            }
            return false;
        }
    }

    window.__pendingLineProfile = profile;
    openRegisterModal(profile);
    return true;
}

// popup ชวนเพิ่มเพื่อนสำหรับ Guest (ไม่บังคับออกจากแอป ผู้ใช้กลับมากดลงทะเบียนใหม่ได้)
async function promptAddFriendInGuest_() {
    if (typeof window.Swal === 'undefined') {
        await showAlert('กรุณาเพิ่มเพื่อน LINE OA (Admin JVBP) ก่อนลงทะเบียน แล้วกดลงทะเบียนอีกครั้ง', 'info', 'กรุณาเพิ่มเพื่อนก่อน');
        window.open(LINE_OA_ADD_FRIEND_URL, '_blank', 'noopener');
        return;
    }
    const result = await window.Swal.fire({
        icon: 'info',
        title: 'กรุณาเพิ่มเพื่อน LINE OA ก่อน',
        text: 'เพิ่มเพื่อนบัญชี Admin JVBP แล้วกดปุ่ม "ลงทะเบียนเข้าใช้" อีกครั้งเพื่อดำเนินการต่อ',
        showCancelButton: true,
        confirmButtonText: 'เพิ่มเพื่อน LINE OA',
        cancelButtonText: 'ปิด',
        confirmButtonColor: '#06C755',
        cancelButtonColor: '#64748b',
        reverseButtons: true,
        heightAuto: false
    });
    if (result.isConfirmed) {
        window.open(LINE_OA_ADD_FRIEND_URL, '_blank', 'noopener');
    }
}

async function initApp() {
    if (authInitializing) return;
    authInitializing = true;

    try {
        const cachedUser = getCachedUser();

        // 1. ถ้ามี Cache เดิมที่เป็น Registered User (มี sessionId และไม่ใช่ Guest) -> Fast Boot เข้าสู่ระบบทันที
        if (cachedUser && cachedUser.sessionId && !cachedUser.isGuest) {
            console.log('Cache Hit: Loading App immediately for session:', cachedUser.sessionId);
            
            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
            await loadAppAssets();
            showApp();

            // ตรวจสอบสิทธิ์ย้อนหลัง และกำหนดค่า LIFF ไว้เบื้องหลัง
            if (typeof liff !== 'undefined') {
                await ensureLiffInit().catch(console.warn);
                await backgroundVerify(cachedUser);
            }
            return;
        }

        // 2. ถ้าไม่มี session ที่เป็น Registered User -> เรียก liff.init ตรวจสอบสถานะบัญชี LINE ก่อน
        ui.splashStatus.innerText = 'กำลังเตรียมระบบ...';
        await ensureLiffInit();

        // ตรวจสอบว่าผู้ใช้ล็อกอิน LINE อยู่แล้วหรือไม่ (เปิดในแอป LINE หรือเคยล็อกอินไว้ในเบราว์เซอร์)
        if (liff.isLoggedIn()) {
            if (isLoginPending()) clearLoginPending();
            loginInProgress = false;

            ui.splashStatus.innerText = 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...';

            const profile = await liff.getProfile().catch(console.error);

            if (profile && profile.userId) {
                // ตรวจสอบสิทธิ์กับชีต Authorized_Users ผ่าน Google Apps Script
                const authResult = await checkBackendAuth_(profile).catch(err => {
                    console.warn('checkBackendAuth_ error:', err);
                    return null;
                });

                if (authResult && (authResult.success || authResult.ok)) {
                    // ผู้ใช้มีสิทธิ์ Active ในระบบอยู่แล้ว! -> เข้าสู่ระบบเป็น Registered User ทันที
                    setCachedUser({
                        userId: profile.userId,
                        displayName: profile.displayName,
                        pictureUrl: profile.pictureUrl,
                        role: authResult.role || 'User',
                        sessionId: authResult.sessionId || '',
                        isGuest: false,
                        timestamp: new Date().getTime()
                    });

                    if (typeof window.setLastVerifiedAt === 'function') {
                        window.setLastVerifiedAt(Date.now());
                    }

                    ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
                    await loadAppAssets();
                    showApp();
                    return;
                }

                // หากไม่ใช่ Active (เช่น รออนุมัติ หรือเป็นผู้ใช้ใหม่):
                // ตรวจสอบว่ากำลังกลับมาจากการกดลงทะเบียนหรือไม่
                const isRegPending = isPendingFlagActive_(REGISTRATION_PENDING_KEY);
                if (isRegPending) {
                    clearPendingFlag_(REGISTRATION_PENDING_KEY);
                    window.__pendingLineProfile = profile;

                    // ไม่ว่า Guest Mode จะยังใช้ได้หรือหมดอายุแล้วก็ตาม ผู้ใช้ที่อยู่ระหว่างขั้นตอน
                    // ลงทะเบียนต้องได้เห็น Registration Modal (Step 2) ต่อเสมอ ห้ามเป็น Dead End
                    if (isGuestModeValid()) {
                        enterGuestMode_();
                        ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ...';
                        await loadAppAssets();
                        showApp();
                    } else {
                        ui.splash.classList.add('is-hidden');
                        ui.error.classList.add('is-hidden');
                        if (ui.follow) ui.follow.classList.add('is-hidden');
                        ui.app.classList.add('is-hidden');
                        ui.login.classList.remove('is-hidden');
                    }
                    // [แก้ไข-Login] เช็คเพื่อนหลัง login ก่อนเปิดฟอร์มเสมอ
                    await routeNonActiveAfterLineLogin_(profile, authResult);
                    return;
                }

                // ถ้าสถานะเป็น Pending (รออนุมัติ) ให้บันทึกสถานะเพื่อแสดงผลที่เมนู
                if (authResult && (authResult.status === 'Pending' || (authResult.reason && authResult.reason.includes('ขอสิทธิ์')))) {
                    localStorage.setItem(REGISTRATION_STATUS_KEY, 'pending');
                }

                // ถ้า Guest Mode ยังไม่หมดอายุ -> ให้เข้าสู่ Guest Mode (Guest Mode มีสิทธิ์เหนือกว่า Follow Page เสมอ)
                if (isGuestModeValid()) {
                    enterGuestMode_();
                    ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ (Guest Mode)...';
                    await loadAppAssets();
                    showApp();
                    return;
                }

                // [เพิ่ม] ถ้า Guest Mode หมดอายุแล้ว และสถานะบัญชีคือ "NotFound" (ยังไม่เคยลงทะเบียนในระบบ)
                // ให้เช็คสถานะการเป็นเพื่อน LINE OA ก่อนเสมอ:
                //   - ยังไม่เป็นเพื่อน -> บังคับแสดง Follow Page ให้เพิ่มเพื่อนก่อน
                //   - เป็นเพื่อนแล้ว -> ให้เป็นไปตามเกณฑ์ผู้ใช้ login LINE แล้ว: เปิด Registration Modal ทันที
                if (authResult && authResult.status === 'NotFound') {
                    ui.splashStatus.innerText = 'กำลังตรวจสอบสถานะการเพิ่มเพื่อน...';
                    const isFriend = await checkAndStoreFriendshipStatus_();

                    if (!isFriend) {
                        showFollowPrompt('เพื่อใช้งานระบบ กรุณาเพิ่มเพื่อนบัญชีทางการก่อน แล้วกดตรวจสอบอีกครั้ง');
                        return;
                    }

                    // เป็นเพื่อนแล้ว -> ข้าม Error Page ไปเปิด Registration Modal ได้เลย
                    window.__pendingLineProfile = profile;
                    ui.splash.classList.add('is-hidden');
                    ui.error.classList.add('is-hidden');
                    if (ui.follow) ui.follow.classList.add('is-hidden');
                    ui.app.classList.add('is-hidden');
                    ui.login.classList.remove('is-hidden');
                    openRegisterModal(profile);
                    return;
                }

                // ถ้า Guest Mode หมดอายุแล้ว (และไม่ใช่กรณี NotFound ด้านบน) -> แสดงหน้าแจ้งเตือนตามผลจาก Backend
                if (authResult && authResult.needFollow) {
                    showFollowPrompt(authResult.reason);
                } else {
                    showError((authResult && authResult.reason) || 'ไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
                }
                return;
            }
        }

        // 3. กรณีไม่ได้ล็อกอิน LINE (liff.isLoggedIn() === false)
        if (isLoginPending()) {
            clearLoginPending();
            loginInProgress = false;
        }

        // ตรวจสอบ Guest Mode (หากยังไม่หมดอายุตาม GUEST_CONFIG.expiryDate)
        if (isGuestModeValid()) {
            enterGuestMode_();
            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ (Guest Mode)...';
            await loadAppAssets();
            showApp();
            return;
        }

        // ถ้าหมดอายุ Guest Mode: ล้างแคช Guest ออก และแสดงหน้า Login
        if (cachedUser && cachedUser.isGuest) {
            clearCachedUser();
        }
        showLogin();

    } catch (error) {
        console.error('LIFF Init Error:', error);
        if (isGuestModeValid()) {
            enterGuestMode_();
            ui.splashStatus.innerText = 'กำลังเปิดระบบสารบรรณ (Guest Mode)...';
            await loadAppAssets();
            showApp();
        } else {
            showError('ไม่สามารถเชื่อมต่อระบบ LINE ได้ กรุณาลองใหม่อีกครั้ง');
        }
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
// [แก้ไข] เปลี่ยนเป็น async function เพื่อ await showAlert() ก่อน reload
// (ไม่งั้นข้อความจะโผล่มาพร้อมหน้ารีโหลดพอดี ผู้ใช้อ่านไม่ทัน)
async function clearLocalSessionAndRedirect_(message) {
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
    // [เพิ่ม-Alert] แจ้งเตือนสิทธิ์/session ถูกยกเลิก -> icon: warning
    if (message) await showAlert(message, 'warning', 'แจ้งเตือน');
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
        // [เพิ่ม-Alert] ออกจากระบบสำเร็จบางส่วน (ข้อมูลในเครื่องถูกลบแล้ว) -> icon: warning
        await showAlert('ไม่สามารถบันทึกการออกจากระบบได้ แต่ข้อมูลในเครื่องถูกลบแล้ว', 'warning', 'เกิดข้อผิดพลาด');
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

        // [แก้ไข-Login] แสดงเมนู "ลงทะเบียนเข้าใช้" แบบปกติเสมอ (ไม่สลับเป็นลิงก์เพิ่มเพื่อนแล้ว)
        // เพราะการกดปุ่มนี้ต้องพาไป Register Modal -> "เชื่อมต่อด้วย LINE" ก่อน
        // ส่วนการเตือนให้เพิ่มเพื่อนจะเกิดหลัง login แล้วเท่านั้น (ถ้าจำเป็น)
        const regBtnNormal = document.getElementById('registerBtnContent_normal');
        const regBtnAddFriend = document.getElementById('registerBtnContent_addFriend');
        if (regBtnNormal) regBtnNormal.classList.remove('is-hidden');
        if (regBtnAddFriend) regBtnAddFriend.classList.add('is-hidden');
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

            // [แก้ไข-Login] ตัด gate "ต้องเป็นเพื่อนก่อนถึงจะเปิด Modal" ออก
            // เหตุผล: liff.getFriendship() เชื่อถือได้เฉพาะหลัง login LIFF แล้วเท่านั้น
            // ถ้าเช็คก่อน login ค่าจะเป็น false ตลอด ทำให้ผู้ใช้ Guest ไม่มีทางไปถึงปุ่ม
            // "เชื่อมต่อด้วย LINE" (ปุ่ม login จริง) ได้เลย แม้แอดมินอนุมัติแล้วก็ตาม
            // การเช็คเพื่อนย้ายไปทำหลัง login แล้วแทน ดู routeNonActiveAfterLineLogin_()
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
    // ปิด Modal ด้วยมือ (ยังไม่ authenticated) -> เคลียร์ pending flag กันไม่ให้ refreshAuthState()
    // หรือ initApp() รอบถัดไปดึง Modal นี้กลับมาเปิดโดยที่ผู้ใช้ไม่ได้ตั้งใจ
    if (!(currentRegisterProfile && currentRegisterProfile.userId)) {
        clearPendingFlag_(REGISTRATION_PENDING_KEY);
    }
}
window.closeRegisterModal = closeRegisterModal;

// ---------------------------------------------------------------------------
// ชั้นสุดท้ายของการกู้สถานะ: ก่อนปิด Modal ด้วยมือ ให้ตรวจสอบ Auth ซ้ำอีกครั้งก่อนเสมอ
// ---------------------------------------------------------------------------
// เผื่อกรณี visibilitychange / pageshow / focus / storage event ทั้งหมดพลาดไปด้วยเหตุผลใดก็ตาม
// (เช่น OS เปิด LINE Login เป็นแอปแยกและ event เหล่านี้ไม่ทำงานตามคาด) การกดปุ่ม "ปิด"/"ยกเลิก"
// ของผู้ใช้จะกลายเป็นจังหวะสุดท้ายที่ระบบเช็ค Auth จริงก่อน แล้วค่อยตัดสินใจว่าจะปิดตามที่ขอ
// หรือแก้ไข UI ให้ตรงกับความเป็นจริง (เช่น เลื่อนไป Step 2 หรือเข้าระบบเลยถ้า Active แล้ว)
// หลักการเดิมยังคงอยู่: การกดปุ่มไม่ใช่ตัวกำหนด Auth State, Auth State เป็นตัวกำหนด UI
async function handleManualCloseRegisterModal_() {
    const closeBtn = document.getElementById('btnCloseRegisterModal');
    const cancelBtn = document.getElementById('btnCancelRegister');
    if (closeBtn) closeBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
        await refreshAuthState('manual-close-recheck');
    } catch (e) {
        console.warn('recheck before close failed:', e);
    } finally {
        if (closeBtn) closeBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
    }

    // ถ้าหลังตรวจสอบแล้วยังไม่ได้เชื่อมต่อ LINE (ยังอยู่ Step 1) หรือ Modal ถูกปิดไปแล้วจากการ
    // ตรวจสอบข้างต้น (Authenticated -> ปิด+reload ไปแล้ว) -> ปิดตามที่ผู้ใช้ต้องการได้เลย
    // แต่ถ้าระบบเพิ่งเลื่อนไป Step 2 ระหว่างตรวจสอบ (เชื่อมต่อ LINE สำเร็จแต่รออนุมัติ) ให้คงเปิดไว้
    // เพื่อไม่ทำให้ผู้ใช้เสียข้อมูล/ต้องกดเชื่อมต่อ LINE ซ้ำโดยไม่จำเป็น
    if (!(currentRegisterProfile && currentRegisterProfile.userId)) {
        closeRegisterModal();
    }
}

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

    if (closeBtn) closeBtn.addEventListener('click', handleManualCloseRegisterModal_);
    if (cancelBtn) cancelBtn.addEventListener('click', handleManualCloseRegisterModal_);

    if (lineConnectBtn) {
        lineConnectBtn.addEventListener('click', async () => {
            // กันการกดซ้ำเร็ว ๆ ระหว่างรอผล LINE Login
            if (lineConnectBtn.disabled) return;
            lineConnectBtn.disabled = true;
            try {
                setPendingFlag_(REGISTRATION_PENDING_KEY);
                if (typeof liff === 'undefined') {
                    // [เพิ่ม-Alert] ปัญหาระบบ (ไม่พบ LIFF SDK) -> icon: error
                    await showAlert('ไม่พบ LINE LIFF SDK', 'error', 'เกิดข้อผิดพลาด');
                    return;
                }
                if (!liff.isLoggedIn()) {
                    // นำทางไป LINE Login ในบริบทเดิม (ไม่เปิด window ใหม่)
                    liff.login();
                    return; // ปล่อยให้ refreshAuthState() หลัง App Resume เป็นผู้ตัดสินขั้นต่อไป
                } else {
                    const profile = await liff.getProfile();
                    // ตรวจสอบกับ Backend ก่อน เผื่อว่าบัญชีนี้ได้รับการอนุมัติเป็น Active แล้ว
                    const authResult = await checkBackendAuth_(profile).catch(() => null);
                    clearPendingFlag_(REGISTRATION_PENDING_KEY);
                    if (authResult && (authResult.success || authResult.ok)) {
                        setCachedUser({
                            userId: profile.userId,
                            displayName: profile.displayName,
                            pictureUrl: profile.pictureUrl,
                            role: authResult.role || 'User',
                            sessionId: authResult.sessionId || '',
                            isGuest: false,
                            timestamp: Date.now()
                        });
                        closeRegisterModal();
                        if (typeof Swal !== 'undefined') {
                            Swal.fire({
                                icon: 'success',
                                title: 'คุณมีสิทธิ์เข้าใช้งานแล้ว',
                                text: 'บัญชีของคุณได้รับการอนุมัติเรียบร้อยแล้ว กำลังเข้าสู่ระบบ...',
                                timer: 1800,
                                showConfirmButton: false
                            }).then(() => {
                                window.location.reload();
                            });
                        } else {
                            window.location.reload();
                        }
                        return;
                    }
                    // [แก้ไข-Login] ยังไม่ Active -> เช็คเพื่อน (login แล้ว เชื่อถือได้) ก่อนเปิดฟอร์ม
                    await routeNonActiveAfterLineLogin_(profile, authResult);
                }
            } catch (err) {
                console.error('Line login for reg error:', err);
                // [เพิ่ม-Alert] ปัญหาการเชื่อมต่อ LINE -> icon: error
                await showAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ LINE: ' + (err.message || err), 'error', 'เชื่อมต่อ LINE ไม่สำเร็จ');
            } finally {
                lineConnectBtn.disabled = false;
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
        // [เพิ่ม-Alert] ข้อมูลไม่ครบถ้วน (ยังไม่เชื่อมต่อ LINE) -> icon: warning
        await showAlert('กรุณาเชื่อมต่อบัญชี LINE ก่อนลงทะเบียน', 'warning', 'ข้อมูลไม่ครบถ้วน');
        return;
    }

    const nickname = (nicknameInput ? nicknameInput.value : '').trim();
    if (!nickname) {
        // [เพิ่ม-Alert] ข้อมูลไม่ครบถ้วน (ไม่กรอกชื่อ) -> icon: warning
        await showAlert('กรุณากรอกชื่อจริงหรือชื่อเล่น', 'warning', 'ข้อมูลไม่ครบถ้วน');
        return;
    }

    let finalOrg = (orgSelect ? orgSelect.value : '').trim();
    if (!finalOrg) {
        // [เพิ่ม-Alert] ข้อมูลไม่ครบถ้วน (ไม่เลือกหน่วยงาน) -> icon: warning
        await showAlert('กรุณาเลือกหน่วยงาน', 'warning', 'ข้อมูลไม่ครบถ้วน');
        return;
    }
    if (finalOrg === 'อื่นๆ(ระบุ)') {
        finalOrg = (otherOrgInput ? otherOrgInput.value.trim() : '');
        if (!finalOrg) {
            // [เพิ่ม-Alert] ข้อมูลไม่ครบถ้วน (ไม่ระบุชื่อหน่วยงาน) -> icon: warning
            await showAlert('กรุณาระบุชื่อหน่วยงาน', 'warning', 'ข้อมูลไม่ครบถ้วน');
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
            if (result.status === 'Active') {
                closeRegisterModal();
                const authResult = await checkBackendAuth_(currentRegisterProfile).catch(() => null);
                if (authResult && (authResult.success || authResult.ok)) {
                    setCachedUser({
                        userId: currentRegisterProfile.userId,
                        displayName: currentRegisterProfile.displayName,
                        pictureUrl: currentRegisterProfile.pictureUrl,
                        role: authResult.role || 'User',
                        sessionId: authResult.sessionId || '',
                        isGuest: false,
                        timestamp: Date.now()
                    });
                }
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'คุณมีสิทธิ์เข้าใช้งานแล้ว',
                        text: 'บัญชีของคุณได้รับการอนุมัติเรียบร้อยแล้ว กำลังเข้าสู่ระบบ...',
                        timer: 1800,
                        showConfirmButton: false
                    }).then(() => {
                        window.location.reload();
                    });
                } else {
                    window.location.reload();
                }
                return;
            }

            // บันทึกสถานะว่าลงทะเบียนแล้ว รออนุมัติ
            localStorage.setItem(REGISTRATION_STATUS_KEY, 'pending');
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
        // [เพิ่ม-Alert] ปัญหาการเชื่อมต่อเซิร์ฟเวอร์ -> icon: error
        await showAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ลงทะเบียน: ' + (err.message || err), 'error', 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
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

    // เริ่มต้น User Notification Bubble (โหลดข้อมูลจาก data/notify.json)
    if (typeof window.initUserNotify === 'function') {
        window.initUserNotify();
    }

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
