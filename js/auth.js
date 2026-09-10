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

ui.logoutBtn.addEventListener('click', () => {
    if (liff && liff.isLoggedIn()) {
        liff.logout();
    }
    localStorage.removeItem('app_user_cache');
    window.location.reload();
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
                    backgroundVerify();
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

// ตรวจสอบสิทธิ์กับ Backend (สำหรับ First Login)
async function verifyWithBackend(profile) {
    try {
        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'login_auth',
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl
            })
        });

        const result = await response.json();

        if (result.success) {
            localStorage.setItem('app_user_cache', JSON.stringify({
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl,
                role: result.role,
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

// ตรวจสอบสิทธิ์แบบ Background 
async function backgroundVerify() {
    try {
        const profile = await liff.getProfile();
        const response = await fetch(AUTH_CONFIG.gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                actionType: 'check_status', 
                userId: profile.userId
            })
        });
        const result = await response.json();

        if (!result.success) {
            if (typeof window.handleBannedUser === 'function') {
                window.handleBannedUser(result.needFollow ? 
                    'กรุณาเพิ่มเพื่อน LINE Official Account อีกครั้งเพื่อใช้งานต่อ' : 
                    'สิทธิ์การเข้าใช้งานของคุณถูกยกเลิกแล้ว');
            } else {
                localStorage.removeItem('app_user_cache');
                if (liff.isLoggedIn()) liff.logout();
                alert('สิทธิ์การเข้าใช้งานของคุณถูกยกเลิกแล้ว');
                window.location.reload();
            }
        } else {
            if (typeof window.setLastVerifiedAt === 'function') {
                window.setLastVerifiedAt(Date.now());
            }
        }
    } catch (error) {
        console.warn('Background verify network error (ignored)', error);
    }
}

// Dynamic Loader แบบเรียงลำดับ
async function loadAppAssets() {
    const cssPromises = APP_ASSETS.css.map(href => {
        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
        });
    });
    await Promise.all(cssPromises);

    for (const src of APP_ASSETS.js) {
        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = src;
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
        btnConfirmLogout.addEventListener('click', () => {
            if (liff && liff.isLoggedIn()) {
                liff.logout();
            }
            localStorage.removeItem('app_user_cache');
            window.location.reload();
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
window.addEventListener('DOMContentLoaded', initApp);

