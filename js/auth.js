// js/auth.js

const AUTH_CONFIG = {
    liffId: '2007032148-vWobwLNE', // Demo
    gasUrl: 'https://script.google.com/macros/s/AKfycbwrnLHNeNb6GHCwVVQF0EGRzxUPrwHjk-Sosg-Wwt9DossOLeZ-nuul2McpLWBhFliP/exec',
};

const APP_ASSETS = {
    css: [
        'css/components.css'
        // หมายเหตุ: variables.css และ layout.css ถูกย้ายไปโหลดแบบ static (blocking)
        // ใน <head> ของ index.html แล้ว เพื่อให้หน้า splash/login/error/follow
        // ใช้ธีมสี/ฟอนต์เดียวกับแอปหลักได้ตั้งแต่เฟรมแรก ไม่ต้องรอโหลดหลัง login
    ],
    js: [
        'https://cdn.jsdelivr.net/npm/chart.js',
        'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
        // หมายเหตุ: three.js และ js/magic-rings-bg.js ถูกย้ายไปโหลดแบบ static
        // ใน <body> ของ index.html แล้ว (ก่อน auth.js) เพื่อให้ ring animation
        // เริ่มทำงานได้ตั้งแต่ splash screen ตัวแรกสุด (ตอนกำลังตรวจสอบสิทธิ์)
        // ไม่ใช่รอโหลดพร้อม dashboard bundle หลัง login สำเร็จเหมือนเดิม
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

if (ui.recheckFriendBtn) {
    ui.recheckFriendBtn.addEventListener('click', () => {
        // ผู้ใช้เพิ่มเพื่อนแล้วกดตรวจสอบอีกครั้ง -> reload หน้าใหม่ทั้งหมด
        // ให้ initApp() รันซ้ำตั้งแต่ต้น (ผ่าน liff.init + verifyWithBackend ใหม่)
        window.location.reload();
    });
}

// ---------------------------------------------------------------------------
// Friendship Check (ตรวจสอบว่าผู้ใช้ add เพื่อน LINE OA แล้วหรือยัง)
//
// ชั้นนี้เป็นการเช็คแบบเร็วฝั่ง client (liff.getFriendship()) เพื่อลดเวลารอ
// backend โดยไม่จำเป็นในกรณีที่ชัดเจนอยู่แล้วว่ายังไม่ได้ add friend
// ความถูกต้อง "จริง" ยังคงอ้างอิงจากผลของ backend (verifyWithBackend /
// backgroundVerify) ซึ่งเรียก LINE Messaging API ที่เชื่อถือได้กว่าเสมอ เพราะ
// ค่าจาก client แก้ไขได้ผ่าน dev tools ห้ามเชื่อ 100%
// ---------------------------------------------------------------------------
async function checkFriendshipClientSide() {
    try {
        const friendship = await liff.getFriendship();
        return friendship.friendFlag; // true / false
    } catch (error) {
        console.warn('ไม่สามารถตรวจสอบสถานะเพื่อนฝั่ง client ได้', error);
        return null; // ไม่ทราบสถานะ -> ปล่อยให้ backend เป็นผู้ตัดสินแทน
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

            // โหลด Script หลักทันทีเพื่อความรวดเร็ว (ring background ที่ splash
            // ยังคงทำงานต่อเนื่องอยู่ระหว่างขั้นตอนนี้ทั้งหมด)
            await loadAppAssets();
            showApp();

            // Background Verify กับ Backend (เงียบๆ) — backend จะเช็ค friendship
            // ไปพร้อมกับ role/สิทธิ์ในคราวเดียว ถ้าโดนตัดสิทธิ์หรือ unfriend
            // บอทไปแล้วจะถูกเด้งออกผ่าน backgroundVerify() ด้านล่าง
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

            // เช็คสถานะเพื่อนฝั่ง client ก่อน (เร็วกว่า) — ถ้าพบว่าไม่ได้เป็น
            // เพื่อนแน่ชัด (false) ให้เด้งไปหน้า "เพิ่มเพื่อน" ทันที ไม่ต้องเสีย
            // เวลารอ backend fetch โปรไฟล์+role ก่อน
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
// Backend เป็นผู้ตัดสินสุดท้ายว่า friend หรือยัง + มี role/สิทธิ์หรือไม่
// คาดหวังรูปแบบผลลัพธ์จาก GAS:
//   success = true  -> { success: true, role: "..." }
//   success = false, ยังไม่ได้ friend -> { success: false, needFollow: true, reason: "..." }
//   success = false, เหตุผลอื่น (ไม่มีสิทธิ์/role ไม่ผ่าน) -> { success: false, reason: "..." }
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
        } else if (result.needFollow) {
            // Backend ยืนยันว่ายังไม่ได้ add friend -> แสดงหน้าเชิญ add friend
            // (แยกจาก error ทั่วไป เพราะเหตุผลและปุ่มที่ต้องโชว์คนละแบบ)
            showFollowPrompt(result.reason);
        } else {
            showError(result.reason || 'ไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        }
    } catch (error) {
        console.error('Verify Auth Error:', error);
        showError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ตรวจสอบสิทธิ์');
    }
}

// ตรวจสอบสิทธิ์แบบ Background (ถ้าสิทธิ์โดนตัด หรือ unfriend บอทไปแล้ว ให้เด้งออก)
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
            // โดนตัดสิทธิ์ หรือ unfriend บอทไปแล้ว
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
    // โหลด CSS ทั้งหมดพร้อมกัน (เหลือแค่ components.css เพราะ variables.css/layout.css
    // ถูกย้ายไปโหลดแบบ static ใน <head> ของ index.html แล้ว)
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

    // โหลด JS เรียงตามลำดับ (เพื่อไม่ให้พังเรื่อง Dependency เช่น Chart.js ต้องมาก่อน
    // config.js ต้องมาก่อน data-service.js/ui-render.js เป็นต้น)
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
    ui.login.classList.add('is-hidden');
    ui.error.classList.add('is-hidden');
    if (ui.follow) ui.follow.classList.add('is-hidden');
    ui.app.classList.remove('is-hidden');
    ui.app.style.display = 'block';

    // สำคัญ: "ไม่" ซ่อน splash ที่นี่โดยเจตนา — appWrapper ถูกวาดอยู่ข้างใต้
    // splash (z-index: 9999) จึงยังไม่เห็นภาพซ้อนใดๆ ให้ผู้ใช้เห็น
    // splash (และ ring background ข้างหลัง) ต้องคงอยู่ต่อจนกว่าข้อมูลจริงจาก
    // Google Sheets จะพร้อมแสดงผลจริง ซึ่งควบคุมโดย startApp() ใน
    // js/data-service.js เพียงจุดเดียวเท่านั้น (ไม่ใช่ที่นี่)

    // เริ่ม flow การโหลดข้อมูล/สร้าง UI ของแอปหลัก — ฟังก์ชันนี้ถูก expose มาจาก
    // data-service.js ที่เพิ่งโหลดเสร็จผ่าน loadAppAssets() ด้านบน (รวมถึง
    // ui-render.js ที่ initAppFlow() ต้องใช้ก็โหลดเสร็จแล้วเช่นกัน ณ จุดนี้)
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

// หน้าเชิญ "เพิ่มเพื่อน LINE OA" — แยกจาก showError เพราะเหตุผล/ปุ่มที่ต้องใช้
// คนละแบบ (ปุ่ม "เพิ่มเพื่อน" + "ตรวจสอบอีกครั้ง" แทนที่จะเป็น "ออกจากระบบ")
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

