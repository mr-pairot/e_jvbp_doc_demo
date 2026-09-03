// js/auth.js

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec', 
};

const APP_ASSETS = {
    css: [
        'css/variables.css',
        'css/layout.css',
        'css/components.css'
    ],
    js: [
        'https://cdn.jsdelivr.net/npm/chart.js',
        'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
        'js/magic-rings-bg.js',
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
    app: document.getElementById('appWrapper'),
    loginBtn: document.getElementById('lineLoginBtn'),
    logoutBtn: document.getElementById('lineLogoutBtn')
};

// Event Listeners
ui.loginBtn.addEventListener('click', () => {
    if (liff && !liff.isLoggedIn()) {
        liff.login();
    }
});

ui.logoutBtn.addEventListener('click', () => {
    if (liff && liff.isLoggedIn()) {
        liff.logout();
    }
    localStorage.removeItem('app_user_cache');
    window.location.reload();
});

// Initialization Flow
async function initApp() {
    try {
        // ตรวจสอบ Cache (Offline-First)
        const cachedUserStr = localStorage.getItem('app_user_cache');
        if (cachedUserStr) {
            const cachedUser = JSON.parse(cachedUserStr);
            console.log('Cache Hit: Loading App immediately for', cachedUser.displayName);
            
            // โหลด Script หลักทันทีเพื่อความรวดเร็ว
            await loadAppAssets();
            showApp();

            // Background Verify กับ Backend (เงียบๆ)
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
            // บันทึก Cache
            localStorage.setItem('app_user_cache', JSON.stringify({
                userId: profile.userId,
                displayName: profile.displayName,
                role: result.role,
                timestamp: new Date().getTime()
            }));

            ui.splashStatus.innerText = 'กำลังดาวน์โหลดข้อมูลระบบ...';
            await loadAppAssets();
            showApp();
        } else {
            showError(result.reason || 'ไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        }
    } catch (error) {
        console.error('Verify Auth Error:', error);
        showError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ตรวจสอบสิทธิ์');
    }
}

// ตรวจสอบสิทธิ์แบบ Background (ถ้าสิทธิ์โดนตัด ให้เด้งออก)
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
            // โดนตัดสิทธิ์
            localStorage.removeItem('app_user_cache');
            if (liff.isLoggedIn()) liff.logout();
            alert('สิทธิ์การเข้าใช้งานของคุณถูกยกเลิกแล้ว');
            window.location.reload();
        }
    } catch (error) {
        console.warn('Background verify failed, using offline cache', error);
    }
}

// Dynamic Loader แบบเรียงลำดับ
async function loadAppAssets() {
    // โหลด CSS ทั้งหมดพร้อมกัน
    const cssPromises = APP_ASSETS.css.map(href => {
        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = resolve; // ข้ามถ้ามีปัญหา
            document.head.appendChild(link);
        });
    });
    await Promise.all(cssPromises);

    // โหลด JS เรียงตามลำดับ (เพื่อไม่ให้พังเรื่อง Dependency เช่น Chart.js ต้องมาก่อน)
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

// การแสดงผลหน้าต่างๆ
function showApp() {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    ui.app.classList.remove('is-hidden');
    ui.app.style.display = 'block';
}

function showLogin() {
    ui.splash.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.login.classList.remove('is-hidden');
}

function showError(reasonText) {
    ui.splash.classList.add('is-hidden');
    ui.login.classList.add('is-hidden');
    ui.app.classList.add('is-hidden');
    ui.error.classList.remove('is-hidden');
    ui.errorReason.innerText = reasonText;
}

// เริ่มการทำงานเมื่อโหลดหน้าเสร็จ
window.addEventListener('DOMContentLoaded', initApp);
