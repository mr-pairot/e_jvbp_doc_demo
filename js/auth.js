// js/auth.js

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec',
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

// Event Listeners สำหรับหน้า Login / Error
ui.loginBtn.addEventListener('click', () => {
    if (liff && !liff.isLoggedIn()) {
        liff.login();
    }
});

// อันนี้สำหรับปุ่ม Logout ในหน้า Error Page (กรณีสิทธิ์ไม่ผ่าน)
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

// Initialization Flow
async function initApp() {
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
                if (liff.isLoggedIn()) {
                    backgroundVerify();
                }
            }
            return;
        }

        // กรณีไม่มี Cache -> Initialize LIFF
        ui.splashStatus.innerText = 'กำลังเชื่อมต่อ LINE...';
        await liff.init({ liffId: AUTH_CONFIG.liffId });

        if (!liff.isLoggedIn()) {
            showLogin();
        } else {
            ui.splashStatus.innerText = 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...';

            const isFriendClientSide = await checkFriendshipClientSide();
            if (isFriendClientSide === false) {
                showFollowPrompt();
                return;
            }

            const profile = await liff.getProfile();
            verifyWithBackend(profile);
        }
    } catch (error) {
        console.error('LIFF Init Error:', error);
        showError('ไม่สามารถเชื่อมต่อระบบ LINE ได้ กรุณาลองใหม่อีกครั้ง');
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
            // บันทึก Cache (เพิ่ม pictureUrl เข้าไปเก็บด้วย เพื่อดึงมาโชว์ใน Profile)
            localStorage.setItem('app_user_cache', JSON.stringify({
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl, 
                role: result.role,
                timestamp: new Date().getTime()
            }));

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
                actionType: 'login_auth',
                userId: profile.userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl
            })
        });
        const result = await response.json();

        if (!result.success) {
            localStorage.removeItem('app_user_cache');
            if (liff.isLoggedIn()) liff.logout();

            if (result.needFollow) {
                alert('กรุณาเพิ่มเพื่อน LINE Official Account อีกครั้งเพื่อใช้งานต่อ');
            } else {
                alert('สิทธิ์การเข้าใช้งานของคุณถูกยกเลิกแล้ว');
            }
            window.location.reload();
        }
    } catch (error) {
        console.warn('Background verify failed, using offline cache', error);
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
            
            // ซ่อน Tooltip ชั่วคราวเวลาเมนูเปิดอยู่ เพื่อความสวยงาม
            if(tooltip) {
                tooltip.style.display = dropdown.classList.contains('is-active') ? 'none' : '';
            }
        });

        // คืนค่า Tooltip เผื่อผู้ใช้ Hover อีกครั้ง
        profileArea.addEventListener('mouseleave', () => {
            if(tooltip) tooltip.style.display = '';
        });
    }

    // คลิกนอกกล่องโปรไฟล์ให้ปิดเมนู
    document.addEventListener('click', (e) => {
        if (dropdown && dropdown.classList.contains('is-active') && profileArea && !profileArea.contains(e.target)) {
            dropdown.classList.remove('is-active');
        }
    });

    // ปุ่มรีเฟรชในเมนู (โยงไปเรียกปุ่ม Refresh ดั้งเดิม)
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
    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.remove('is-hidden');
    ui.app.style.display = 'block';

    // เรียกฟังก์ชันเตรียม UI โปรไฟล์มุมขวาบนเมื่อแสดงแอปหลัก
    initProfileUI();

    if (typeof window.initDashboardApp === 'function') {
        window.initDashboardApp();
    } else {
        console.error('window.initDashboardApp ไม่พร้อมใช้งาน (data-service.js อาจโหลดไม่สำเร็จ)');
    }
}

function showLogin() {
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

