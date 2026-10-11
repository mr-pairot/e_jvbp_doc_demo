/* data-service.js — ระบบสารบรรณอิเล็กทรอนิกส์
   จุดเริ่มต้นการทำงานของแอป (Bootstrap) + การดึงและแปลงข้อมูลจาก Google Sheets + ระบบ Cache
   ========================================================================= */

// ---------------------------------------------------------------------------
// Session Guard & Auth Revalidation
// ---------------------------------------------------------------------------
window.lastVerifiedAt = 0;
window.REVALIDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 นาที (300,000 ms)

window.setLastVerifiedAt = function(timeMs) {
    window.lastVerifiedAt = timeMs || Date.now();
};

// ---------------------------------------------------------------------------
// App Version Update Check
// ---------------------------------------------------------------------------
const APP_VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastAppVersionCheckAt = 0;
let appVersionCheckInProgress = false;
let versionPromptShownFor = null;
let pendingAppVersion = null;

async function checkForAppVersionUpdate(force = false) {
    const now = Date.now();
    if (appVersionCheckInProgress || (!force && now - lastAppVersionCheckAt < APP_VERSION_CHECK_INTERVAL_MS)) {
        return false;
    }

    appVersionCheckInProgress = true;
    lastAppVersionCheckAt = now;

    try {
        // เติม query และใช้ no-store เพื่อข้าม HTTP cache ของ version manifest เสมอ
        const separator = APP_VERSION_MANIFEST_URL.includes('?') ? '&' : '?';
        const response = await fetch(`${APP_VERSION_MANIFEST_URL}${separator}t=${now}`, {
            cache: 'no-store'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const manifest = await response.json();
        const latestVersion = typeof manifest.version === 'string' ? manifest.version.trim() : '';
        if (!latestVersion || latestVersion === APP_CACHE_VERSION || versionPromptShownFor === latestVersion) {
            return false;
        }

        versionPromptShownFor = latestVersion;
        pendingAppVersion = latestVersion;
        showUpdateNotifyButton(`พบแอปเวอร์ชันใหม่ (${latestVersion}) ${UPDATE_NOTIFY_CONFIG.actionText}`);
        return true;
    } catch (error) {
        // การตรวจ version เป็น enhancement: network error ต้องไม่กระทบการใช้งานปกติ
        console.warn('Unable to check app version:', error);
        return false;
    } finally {
        appVersionCheckInProgress = false;
    }
}

function updateAppToLatestVersion(version) {
    // เพิ่ม query ให้ navigation เป็น URL ใหม่ เพื่อให้ browser revalidate index และ script assets
    const url = new URL(window.location.href);
    url.searchParams.set('appVersion', version);
    window.location.replace(url.toString());
}

window.handleBannedUser = async function(reasonText) {
    // 1. เคลียร์ LocalStorage
    localStorage.removeItem('app_user_cache');
    
    // 2. เคลียร์ IndexedDB
    try {
        const db = await openCacheDB();
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        tx.objectStore(IDB_STORE_NAME).delete(CACHE_KEY);
    } catch (e) {
        console.warn("ไม่สามารถลบ IndexedDB Cache ได้", e);
    }
    
    // 3. Logout LIFF
    if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
        liff.logout();
    }
    
    // 4. แสดงหน้า Error Page
    if (typeof showError === 'function') {
        showError(reasonText || 'สิทธิ์การเข้าใช้งานของคุณถูกระงับ');
    }
};

window.verifyStatus = async function() {
    if (typeof liff === 'undefined' || !liff.isLoggedIn()) return false;
    try {
        const profile = await liff.getProfile();
        const cache = JSON.parse(localStorage.getItem('app_user_cache') || '{}');

        // เรียกใช้ AUTH_CONFIG.gasUrl (ประกาศไว้ใน auth.js)
        const response = await fetch(AUTH_CONFIG.gasUrl, { 
            method: 'POST',
            body: JSON.stringify({
                actionType: 'verify_session',
                action: 'verify_session',
                userId: profile.userId,
                sessionId: cache.sessionId
            })
        });
        const result = await response.json();
        
        const isOk = result.success || result.ok;
        if (isOk) {
            window.setLastVerifiedAt(Date.now());
            return true;
        } else {
            let msg = 'ตรวจสอบสิทธิ์ไม่ผ่าน';
            if (result.reason === 'SESSION_LOGGED_OUT') {
                msg = 'คุณถูกออกจากระบบจากอุปกรณ์นี้ กรุณาเข้าสู่ระบบใหม่';
            } else if (result.reason === 'SESSION_NOT_FOUND') {
                msg = 'เซสชันหมดอายุหรือไม่พบข้อมูล กรุณาเข้าสู่ระบบใหม่';
            } else if (result.reason === 'banned') {
                msg = 'สิทธิ์การเข้าใช้งานของคุณถูกระงับ';
            }

            if (typeof window.clearLocalSessionAndRedirect_ === 'function') {
                window.clearLocalSessionAndRedirect_(msg);
            } else if (typeof window.handleBannedUser === 'function') {
                window.handleBannedUser(msg);
            }
            return false;
        }
    } catch (error) {
        console.warn("Network error during verifyStatus", error);
        // กรณี Network Error ปล่อยผ่านเป็น false เฉยๆ ไม่ต้องเตะออก
        return false; 
    }
};

// ---------------------------------------------------------------------------
// ฟังก์ชันเรียก API ข้อมูลและจัดการ Session
// ---------------------------------------------------------------------------
window.fetchMySessions = async function() {
    const cache = JSON.parse(localStorage.getItem("app_user_cache") || "{}");
    if (!cache.userId || !cache.sessionId) {
        return { ok: false, reason: "NO_SESSION" };
    }
    const response = await fetch(AUTH_CONFIG.gasUrl, {
        method: "POST",
        body: JSON.stringify({
            actionType: "list_my_sessions",
            action: "list_my_sessions",
            userId: cache.userId,
            sessionId: cache.sessionId
        })
    });
    return response.json();
};

window.requestLogoutSession = async function(targetSessionId) {
    const cache = JSON.parse(localStorage.getItem("app_user_cache") || "{}");
    if (!cache.userId || !cache.sessionId) {
        return { ok: false, reason: "NO_SESSION" };
    }
    const response = await fetch(AUTH_CONFIG.gasUrl, {
        method: "POST",
        body: JSON.stringify({
            actionType: "logout_session",
            action: "logout_session",
            userId: cache.userId,
            sessionId: cache.sessionId,
            targetSessionId: targetSessionId
        })
    });
    return response.json();
};

// ---------------------------------------------------------------------------
// ล้างพารามิเตอร์ auth ของ LIFF (state, code, liffClientId ฯลฯ)
// ออกจาก query string ทันทีหลัง login สำเร็จ เพื่อไม่ให้ค้างติด URL
// ---------------------------------------------------------------------------
function cleanupLiffAuthParamsFromURL() {
    const url = new URL(window.location.href);
    if (url.search) {
        const cleanUrl = url.origin + url.pathname + url.hash;
        history.replaceState(null, '', cleanUrl);
    }
}

// ---------------------------------------------------------------------------
// 1. Bootstrap
// ---------------------------------------------------------------------------

window.initDashboardApp = function () {
    initPaginationButtons();
    initCacheEvents(); 
    initDiagnosticToggle(); 
    createUpdateNotifyButton(); 
    startAppVersionChecks();
    checkForAppVersionUpdate(true);
    if (typeof window.initProfileMenuEvents === 'function') {
        window.initProfileMenuEvents();
    }
    updateInfoVersionBox();
    initAppFlow();
};

window.startApp = function (tabId) {
    const splashScreen = document.getElementById("splashScreen");
    splashScreen.classList.add("is-fading-out");

    if (window.__magicRingsDestroy) {
        window.__magicRingsDestroy();
        window.__magicRingsDestroy = null;
    }

    setTimeout(() => {
        splashScreen.classList.add("is-hidden");
        switchTab(tabId);
    }, 400);
};

// ---------------------------------------------------------------------------
// IndexedDB Wrapper (เปิด DB / อ่าน-เขียนข้อมูลพื้นฐาน)
// ---------------------------------------------------------------------------
const IDB_NAME = "BPNP_DOC_DB";
const IDB_VERSION = 1;
const IDB_STORE_NAME = "cache_store";
const CACHE_KEY = "BPNP_DOC_CACHE"; 

let idbPromiseSingleton = null;

function openCacheDB() {
    if (idbPromiseSingleton) return idbPromiseSingleton;

    idbPromiseSingleton = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("เบราว์เซอร์นี้ไม่รองรับ IndexedDB"));
            return;
        }
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error || new Error("เปิด IndexedDB ไม่สำเร็จ"));
        request.onblocked = () => reject(new Error("IndexedDB ถูก block (มีแท็บอื่นค้าง connection เก่าอยู่)"));
    });

    return idbPromiseSingleton;
}

async function idbPut(id, dataObject) {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.put({ id, ...dataObject });
        req.onsuccess = () => resolve(true);
        req.onerror = (event) => reject(event.target.error || new Error("บันทึกข้อมูลไม่สำเร็จ"));
    });
}

async function idbGet(id) {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, "readonly");
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (event) => reject(event.target.error || new Error("อ่านข้อมูลไม่สำเร็จ"));
    });
}

// ---------------------------------------------------------------------------
// Cache Management & Force Refresh
// ---------------------------------------------------------------------------
const CACHE_DURATION_MS = 15 * 60 * 1000; 

function formatTimestampTo24H(ms) {
    const date = new Date(ms);
    return `ข้อมูลล่าสุด : ${date.toLocaleDateString('th-TH')} เวลา ${date.toLocaleTimeString('th-TH', { hour12: false })} น.`;
}

function updateCacheStatusUI(timestampText) {
    const statusTextEl = document.getElementById("cacheLastUpdateText");
    if (statusTextEl) {
        statusTextEl.textContent = timestampText;
    }
}

const cacheDiagnosticState = {
    lastSaveOk: null,      
    lastSaveError: null,   
    lastSaveSizeBytes: 0,  
    lastLoadOk: null,      
    lastLoadError: null,
    lastLoadReason: ""     
};

async function saveToCache() {
    const cacheData = {
        timestamp: Date.now(),
        version: APP_CACHE_VERSION, 
        rfa: DOCUMENTS_BY_TAB.rfa,
        rfi: DOCUMENTS_BY_TAB.rfi,
        letter: DOCUMENTS_BY_TAB.letter
    };
    try {
        cacheDiagnosticState.lastSaveSizeBytes = new Blob([JSON.stringify(cacheData)]).size;
        await idbPut(CACHE_KEY, cacheData);
        cacheDiagnosticState.lastSaveOk = true;
        cacheDiagnosticState.lastSaveError = null;
    } catch (e) {
        console.warn("ไม่สามารถบันทึก Cache ลง IndexedDB ได้:", e);
        cacheDiagnosticState.lastSaveOk = false;
        cacheDiagnosticState.lastSaveError = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
    }
    await runCacheDiagnostic(); 
}

async function loadFromCache() {
    try {
        const record = await idbGet(CACHE_KEY);
        if (!record) {
            cacheDiagnosticState.lastLoadOk = false;
            cacheDiagnosticState.lastLoadError = null;
            cacheDiagnosticState.lastLoadReason = "ไม่พบ record แคชใน IndexedDB (ยังไม่เคยบันทึก หรือบันทึกไม่สำเร็จ)";
            await runCacheDiagnostic();
            return null;
        }

        if (record.version !== APP_CACHE_VERSION) {
            cacheDiagnosticState.lastLoadOk = false;
            cacheDiagnosticState.lastLoadError = null;
            cacheDiagnosticState.lastLoadReason = `พบแคชแต่ version ไม่ตรง (แคชเป็น v${record.version ?? "ไม่ทราบ"}, แอปปัจจุบันคือ v${APP_CACHE_VERSION}) → บังคับดึงข้อมูลใหม่`;
            await runCacheDiagnostic();
            return null;
        }

        const now = Date.now();
        const ageMs = now - record.timestamp;

        if (ageMs < CACHE_DURATION_MS) {
            cacheDiagnosticState.lastLoadOk = true;
            cacheDiagnosticState.lastLoadError = null;
            cacheDiagnosticState.lastLoadReason = `พบแคชอายุ ${Math.round(ageMs / 1000)} วินาที (ยังไม่หมดอายุ) → ใช้แคชได้`;
            await runCacheDiagnostic();
            return record;
        }
        cacheDiagnosticState.lastLoadOk = false;
        cacheDiagnosticState.lastLoadError = null;
        cacheDiagnosticState.lastLoadReason = `พบแคชแต่หมดอายุแล้ว (อายุ ${Math.round(ageMs / 60000)} นาที > 15 นาที) → ต้องดึงข้อมูลใหม่`;
        await runCacheDiagnostic();
        return null; 
    } catch (e) {
        console.warn("ไม่สามารถอ่าน Cache จาก IndexedDB ได้:", e);
        cacheDiagnosticState.lastLoadOk = false;
        cacheDiagnosticState.lastLoadError = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
        cacheDiagnosticState.lastLoadReason = "เกิดข้อผิดพลาดขณะอ่านข้อมูลแคชจาก IndexedDB (ดู lastLoadError)";
        await runCacheDiagnostic();
        return null;
    }
}

function initCacheEvents() {
    const btnForce = document.getElementById("btnForceRefresh");
    if (btnForce) {
        btnForce.addEventListener("click", async () => {
            const splashScreen = document.getElementById("splashScreen");
            const splashStatus = document.getElementById("splashStatus");
            splashScreen.classList.remove("is-hidden", "is-fading-out");
            if (splashStatus) splashStatus.textContent = "กำลังอัปเดตข้อมูลจากฐานข้อมูล...";

            if (typeof window.startMagicRingsBg === "function") window.startMagicRingsBg();

            await initAppFlow(true);
        });
    }
}

// ---------------------------------------------------------------------------
// Cache Diagnostic Report 
// ---------------------------------------------------------------------------

async function testIndexedDBAvailability() {
    try {
        await openCacheDB();
        return { available: true, error: null };
    } catch (e) {
        return {
            available: false,
            error: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e))
        };
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function inspectCacheRecord() {
    try {
        const record = await idbGet(CACHE_KEY);
        if (!record) return { exists: false, sizeBytes: 0, ageText: "-", timestamp: null };

        let sizeBytes = 0;
        try {
            sizeBytes = new Blob([JSON.stringify(record)]).size;
        } catch (sizeErr) {
            sizeBytes = 0;
        }

        let ageText = "-";
        if (record.timestamp) {
            const ageMs = Date.now() - record.timestamp;
            const ageMin = Math.floor(ageMs / 60000);
            const ageSec = Math.floor((ageMs % 60000) / 1000);
            const withinLimit = ageMs < CACHE_DURATION_MS;
            ageText = `${ageMin} นาที ${ageSec} วินาที ${withinLimit ? "(ยังไม่หมดอายุ ✅)" : "(หมดอายุแล้ว ⏰)"}`;
        }

        return { exists: true, sizeBytes, ageText, timestamp: record.timestamp || null };
    } catch (e) {
        return { exists: false, sizeBytes: 0, ageText: "-", timestamp: null, readError: (e && e.message) || String(e) };
    }
}

async function getStorageEstimate() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                supported: true,
                usage: estimate.usage || 0,
                quota: estimate.quota || 0
            };
        }
        return { supported: false };
    } catch (e) {
        return { supported: false, error: (e && e.message) || String(e) };
    }
}

function initDiagnosticToggle() {
    const btnToggle = document.getElementById("btnToggleDiagnostic");
    const contentEl = document.getElementById("cacheDiagnosticContent");
    if (btnToggle && contentEl) {
        btnToggle.addEventListener("click", () => {
            const isHidden = contentEl.classList.toggle("is-hidden");
            btnToggle.textContent = isHidden ? "แสดง" : "ซ่อน";
        });
    }
}

async function runCacheDiagnostic() {
    const box = document.getElementById("cacheDiagnosticBox");
    const content = document.getElementById("cacheDiagnosticContent");
    if (!box || !content) return;

    const storageTest = await testIndexedDBAvailability();
    const cacheInfo = await inspectCacheRecord();
    const storageEstimate = await getStorageEstimate();

    const lines = [];

    lines.push({
        label: "IndexedDB ใช้งานได้",
        value: storageTest.available ? "✅ ใช้งานได้ปกติ" : `❌ ใช้งานไม่ได้ (${storageTest.error})`,
        warn: !storageTest.available
    });

    lines.push({
        label: `พบ record แคช "${CACHE_KEY}" ใน IndexedDB`,
        value: cacheInfo.exists ? "✅ พบ" : "❌ ไม่พบ",
        warn: !cacheInfo.exists
    });

    if (cacheInfo.exists) {
        lines.push({ label: "ขนาดข้อมูลแคชปัจจุบัน", value: formatBytes(cacheInfo.sizeBytes), warn: false });
        lines.push({ label: "อายุแคชปัจจุบัน", value: cacheInfo.ageText, warn: false });
    }
    if (cacheInfo.readError) {
        lines.push({ label: "หมายเหตุ", value: `⚠️ อ่านข้อมูลแคชผิดพลาด: ${cacheInfo.readError}`, warn: true });
    }

    if (cacheDiagnosticState.lastSaveOk !== null) {
        lines.push({
            label: "ผลบันทึกแคชล่าสุด (ครั้งนี้)",
            value: cacheDiagnosticState.lastSaveOk
                ? `✅ บันทึกสำเร็จ (${formatBytes(cacheDiagnosticState.lastSaveSizeBytes)})`
                : `❌ บันทึกล้มเหลว: ${cacheDiagnosticState.lastSaveError}`,
            warn: !cacheDiagnosticState.lastSaveOk
        });
    }

    if (cacheDiagnosticState.lastLoadReason) {
        lines.push({
            label: "ผลอ่านแคชล่าสุด (ครั้งนี้)",
            value: (cacheDiagnosticState.lastLoadOk ? "✅ " : "ℹ️ ") + cacheDiagnosticState.lastLoadReason +
                   (cacheDiagnosticState.lastLoadError ? ` (error: ${cacheDiagnosticState.lastLoadError})` : ""),
            warn: cacheDiagnosticState.lastLoadError !== null
        });
    }

    if (storageEstimate.supported) {
        const usedText = formatBytes(storageEstimate.usage);
        const quotaText = formatBytes(storageEstimate.quota);
        const percent = storageEstimate.quota > 0 ? ((storageEstimate.usage / storageEstimate.quota) * 100).toFixed(2) : "0";
        lines.push({
            label: "พื้นที่จัดเก็บที่ใช้ไปทั้งหมด (Storage Estimate)",
            value: `${usedText} / ${quotaText} (${percent}%)`,
            warn: storageEstimate.quota > 0 && (storageEstimate.usage / storageEstimate.quota) > 0.9
        });
    }

    lines.push({ label: "User Agent", value: navigator.userAgent, warn: false, small: true });

    content.innerHTML = lines.map(line => `
        <div class="cache_diagnostic_line ${line.warn ? 'is-warn' : ''}">
            <span class="cache_diagnostic_label">${escapeHTML(line.label)}</span>
            <span class="cache_diagnostic_value ${line.small ? 'is-small' : ''}">${escapeHTML(String(line.value))}</span>
        </div>
    `).join('');

    box.classList.remove("is-hidden");
}

// ---------------------------------------------------------------------------
// Data Fetching & Parsing
// ---------------------------------------------------------------------------

function parseGvizResponseText(text) {
    const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    if (!jsonString) return [];

    const data = JSON.parse(jsonString);
    if (data.status === 'error' || !data.table || !data.table.rows) return [];
    return data.table.rows;
}

async function fetchGvizSheetWithProgress(sheetName, onProgress) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(url);

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    const canTrackBytes = !!(res.body && typeof res.body.getReader === 'function' && totalBytes > 0);

    if (!canTrackBytes) {
        if (onProgress) onProgress(0);
        const text = await res.text();
        if (onProgress) onProgress(100);
        return parseGvizResponseText(text);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let receivedBytes = 0;
    let resultText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.length;
        resultText += decoder.decode(value, { stream: true });
        const pct = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
        if (onProgress) onProgress(pct);
    }
    resultText += decoder.decode(); 
    if (onProgress) onProgress(100);

    return parseGvizResponseText(resultText);
}

// เก็บ URL ของเอกสารไว้กับรายการ เพื่อให้ UI เปิดไฟล์ได้ทั้งจากข้อมูลสดและแคช
function parseRowToDoc(rowObj, id, category) {
    if (!rowObj.c || !rowObj.c[2] || !rowObj.c[2].v) return null;

    const rawTitle = toDisplayString(rowObj.c[2].v);
    const lowerTitle = rawTitle.toLowerCase();
    if (['file name', 'filename', 'name', 'ชื่อไฟล์', 'ชื่อเอกสาร', 'document'].includes(lowerTitle)) return null;

    const title = rawTitle.replace(/\.pdf\.\.\.$/i, '.pdf');
    let fileName = title;
    if (!fileName.toLowerCase().endsWith('.pdf') && !fileName.toLowerCase().endsWith('.dwg')) {
        fileName += ".pdf";
    }

    let cxCode = "Others";
    const cxMatch = title.match(/\(([^)]+)\)/);
    if (cxMatch) {
        cxCode = cxMatch[1].trim();
    }

    let parsedCode = "Others";
    const dashParts = title.split('-');

    const typeIndex = dashParts.findIndex(part => {
        const p = part.trim().toUpperCase();
        return p === "SUB" || p === "DWG";
    });

    if (typeIndex !== -1) {
        parsedCode = dashParts.slice(0, typeIndex + 1).join('-').trim().toUpperCase();
    } else if (dashParts.length >= 2) {
        parsedCode = dashParts.slice(0, 2).join('-').trim().toUpperCase();
    } else if (dashParts.length === 1 && dashParts[0].trim() !== "") {
        parsedCode = dashParts[0].trim().toUpperCase();
    }

    let updateDate = "-";
    if (rowObj.c[4]) {
        let rawDate = rowObj.c[4].f || toDisplayString(rowObj.c[4].v);
        if (rawDate.includes('/')) {
            const dateParts = rawDate.split('/');
            if (dateParts.length === 3) {
                const twoDigitYear = dateParts[2].length === 4 ? dateParts[2].slice(-2) : dateParts[2];
                updateDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}/${twoDigitYear}`;
            } else {
                updateDate = rawDate;
            }
        } else {
            const dateMatch = rawDate.match(/Date\((\d+),(\d+),(\d+)\)/);
            if (dateMatch) updateDate = `${String(dateMatch[3]).padStart(2, '0')}/${String(parseInt(dateMatch[2]) + 1).padStart(2, '0')}/${dateMatch[1].slice(-2)}`;
        }
    }

    let docCategory = category;
    if (parsedCode && parsedCode.length >= 3) {
        const suffix = parsedCode.slice(-3).toUpperCase();
        if (suffix === "SUB" || suffix === "DWG") {
            docCategory = suffix;
        } else {
            docCategory = "อื่นๆ"; 
        }
    } else {
        docCategory = "อื่นๆ";
    }

    const linkValue = toDisplayString(rowObj.c[3]?.v);

    return {
        id,
        folderName: toDisplayString(rowObj.c[0]?.v),
        pathCode: toDisplayString(rowObj.c[1]?.v),
        parsedCode,
        cxCode,
        title,
        fileName,
        documentUrl: linkValue,
        hasLink: !!linkValue && linkValue.startsWith("http"),
        updateDate,
        category: docCategory
    };
}

// เก็บ URL ของเอกสารไว้กับรายการ เพื่อให้ UI เปิดไฟล์ได้ทั้งจากข้อมูลสดและแคช
function parseLetterRowToDoc(rowObj, id) {
    if (!rowObj.c) return null;

    let updateDate = "-";
    if (rowObj.c[5]) {
        let rawDate = rowObj.c[5].f || toDisplayString(rowObj.c[5].v);
        if (rawDate.includes('/')) {
            const dateParts = rawDate.split('/');
            if (dateParts.length === 3) {
                const twoDigitYear = dateParts[2].length === 4 ? dateParts[2].slice(-2) : dateParts[2];
                updateDate = `${dateParts[0].padStart(2, '0')}/${dateParts[1].padStart(2, '0')}/${twoDigitYear}`;
            } else {
                updateDate = rawDate;
            }
        } else {
            const dateMatch = rawDate.match(/Date\((\d+),(\d+),(\d+)\)/);
            if (dateMatch) updateDate = `${String(dateMatch[3]).padStart(2, '0')}/${String(parseInt(dateMatch[2]) + 1).padStart(2, '0')}/${dateMatch[1].slice(-2)}`;
        }
    }

    const linkValue = toDisplayString(rowObj.c[4]?.v);

    return {
        id,
        parsedCode: toDisplayString(rowObj.c[0]?.v), 
        receiveNo: toDisplayString(rowObj.c[1]?.v),  
        letterNo: toDisplayString(rowObj.c[2]?.v),   
        title: toDisplayString(rowObj.c[3]?.v),      
        documentUrl: linkValue,
        hasLink: !!linkValue && linkValue.startsWith("http"),
        updateDate: updateDate,                      
        category: "Letter"
    };
}

// ---------------------------------------------------------------------------
// Splash Progress Bar UI 
// ---------------------------------------------------------------------------
function showLoadProgressUI() {
    const wrap = document.getElementById("splashProgressWrap");
    if (!wrap) return;
    wrap.classList.remove("is-hidden");
    updateLoadProgressUI(0);
}

function hideLoadProgressUI() {
    const wrap = document.getElementById("splashProgressWrap");
    if (wrap) wrap.classList.add("is-hidden");
}

function updateLoadProgressUI(percent, statusText) {
    const wrap = document.getElementById("splashProgressWrap");
    const fillEl = document.getElementById("splashProgressFill");
    const percentEl = document.getElementById("splashProgressPercent");
    if (!wrap) return;

    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (fillEl) fillEl.style.width = clamped + "%";
    if (percentEl) percentEl.textContent = clamped + "%";

    if (statusText) {
        const splashStatus = document.getElementById("splashStatus");
        if (splashStatus) splashStatus.textContent = statusText;
    }
}

async function fetchLiveGoogleSheets() {
    try {
        showLoadProgressUI();

        const sheetProgress = { SUB: 0, DWG: 0, RFI: 0, Letter: 0 };
        const reportSheetProgress = (name, pct) => {
            sheetProgress[name] = pct;
            const avgPct = (sheetProgress.SUB + sheetProgress.DWG + sheetProgress.RFI + sheetProgress.Letter) / 4;
            const overallPct = avgPct * 0.9; 
            updateLoadProgressUI(overallPct, `กำลังดึงข้อมูลจาก Google Sheets...`);
        };

        const [subRows, dwgRows, rfiRows, letterRows] = await Promise.all([
            fetchGvizSheetWithProgress("SUB", (p) => reportSheetProgress("SUB", p)),
            fetchGvizSheetWithProgress("DWG", (p) => reportSheetProgress("DWG", p)),
            fetchGvizSheetWithProgress("RFI", (p) => reportSheetProgress("RFI", p)),
            fetchGvizSheetWithProgress("Letter", (p) => reportSheetProgress("Letter", p))
        ]);

        updateLoadProgressUI(92, "กำลังประมวลผลข้อมูล...");

        let idCounter = 1;
        const liveRFA = [];
        const liveRFI = [];
        const liveLetter = [];

        subRows.forEach(row => { const doc = parseRowToDoc(row, idCounter++, "SUB"); if (doc) liveRFA.push(doc); });
        dwgRows.forEach(row => { const doc = parseRowToDoc(row, idCounter++, "DWG"); if (doc) liveRFA.push(doc); });
        rfiRows.forEach(row => { const doc = parseRowToDoc(row, idCounter++, "RFI"); if (doc) liveRFI.push(doc); });

        letterRows.forEach(row => {
            const doc = parseLetterRowToDoc(row, idCounter++);
            if (doc && (doc.receiveNo || doc.title)) liveLetter.push(doc);
        });

        updateLoadProgressUI(100, "โหลดข้อมูลสำเร็จ");

        return {
            success: true,
            data: { rfa: liveRFA, rfi: liveRFI, letter: liveLetter },
            totalRows: liveRFA.length + liveRFI.length + liveLetter.length
        };
    } catch (err) {
        console.warn("Failed to fetch Google Sheets live data:", err);
        return { success: false, data: null, totalRows: 0 };
    }
}

// ---------------------------------------------------------------------------
// Data Validation
// ---------------------------------------------------------------------------
const DATA_DROP_THRESHOLD_RATIO = 0.20;   
const DATA_MIN_BASELINE_ROWS = 5;         
const TAB_LABELS_TH = { rfa: "RFA", rfi: "RFI", letter: "Letter In" };

async function getRawCacheRecord() {
    try {
        return await idbGet(CACHE_KEY);
    } catch (e) {
        return null;
    }
}

function validateLiveDataAgainstBaseline(liveData, baselineRecord) {
    if (!baselineRecord) {
        return { valid: true, reasons: [] };
    }

    const tabs = ["rfa", "rfi", "letter"];
    const reasons = [];
    let valid = true;

    tabs.forEach(tab => {
        const oldCount = (baselineRecord[tab] || []).length;
        const newCount = (liveData[tab] || []).length;
        const label = TAB_LABELS_TH[tab];

        if (oldCount === 0) return; 

        if (newCount === 0) {
            valid = false;
            reasons.push(`${label}: ข้อมูลหายไปทั้งหมด (เดิมมี ${oldCount} รายการ)`);
            return;
        }

        if (oldCount >= DATA_MIN_BASELINE_ROWS) {
            const dropRatio = (oldCount - newCount) / oldCount;
            if (dropRatio > DATA_DROP_THRESHOLD_RATIO) {
                valid = false;
                reasons.push(`${label}: จำนวนรายการลดลง ${(dropRatio * 100).toFixed(0)}% (เดิม ${oldCount} → ใหม่ ${newCount} รายการ)`);
            }
        }
    });

    return { valid, reasons };
}

// ---------------------------------------------------------------------------
// Data Warning Banner
// ---------------------------------------------------------------------------
function showDataWarningBanner(reasons) {
    const banner = document.getElementById("dataWarningBanner");
    const textGroup = document.getElementById("dataWarningBannerText");
    if (!banner || !textGroup) return;

    const reasonLines = (reasons && reasons.length ? reasons : [])
        .map(r => `<div class="data_warning_reason_line">• ${escapeHTML(r)}</div>`)
        .join('');

    textGroup.innerHTML = `
        <div class="data_warning_headline">ตรวจพบข้อมูลจาก Google Sheets ผิดปกติ (อาจกำลังอัปเดตชีทอยู่) ระบบจึงแสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน</div>
        ${reasonLines}
    `;
    banner.classList.remove("is-hidden");
}

function hideDataWarningBanner() {
    const banner = document.getElementById("dataWarningBanner");
    if (banner) banner.classList.add("is-hidden");
}

// ---------------------------------------------------------------------------
// No Data State 
// ---------------------------------------------------------------------------
function showNoDataState() {
    const tableCard = document.querySelector(".table_card");
    const noDataBox = document.getElementById("noDataBox");
    if (tableCard) tableCard.classList.add("is-hidden");
    if (noDataBox) noDataBox.classList.remove("is-hidden");
}

function hideNoDataState() {
    const tableCard = document.querySelector(".table_card");
    const noDataBox = document.getElementById("noDataBox");
    if (tableCard) tableCard.classList.remove("is-hidden");
    if (noDataBox) noDataBox.classList.add("is-hidden");
}

// ---------------------------------------------------------------------------
// Update Notify Button
// ---------------------------------------------------------------------------

// ค่าตั้งต้นทั้งหมดของปุ่ม + กล่องข้อความ แก้ที่นี่ที่เดียว
const UPDATE_NOTIFY_CONFIG = {
    // --- จังหวะเวลา ---
    showDelayMs: 500,            // กล่องโผล่ช้ากว่าปุ่มกี่ ms
    foldMs: 400,                 // ระยะเวลาคลี่/ยุบกล่อง (ส่งให้ CSS ผ่านตัวแปร)
    displayMs: 12000,            // กล่องค้างอยู่กี่ ms (นับจากเริ่มคลี่) ก่อนยุบ
    hoverReplay: true,           // hover ด้วยเมาส์/ปากกา แล้วเล่นซ้ำ

    // --- ข้อความ ---
    actionText: "แตะเพื่ออัปเดต", // ส่วนท้ายที่ตัววิ่งจะหยุดค้าง

    // --- ตัววิ่ง ---
    marqueeEnabled: true,        // false = ข้อความนิ่ง (ตัดได้ 2 บรรทัด ไม่วิ่ง)
    marqueeLoops: 2,             // จำนวนรอบ (รอบสุดท้ายจะหยุดค้างที่ actionText)
    marqueeSpeedPxPerSec: 60,    // ความเร็ว (พิกเซล/วินาที) ยิ่งมากยิ่งเร็ว
    marqueeGapPx: 24,            // ระยะห่างระหว่างข้อความหน้ากับ actionText
    marqueeAutoFit: true,        // true = เร่งความเร็วอัตโนมัติถ้าวิ่งไม่จบก่อนกล่องยุบ
    marqueeHoldMs: 500           // เวลาที่ต้องการให้ข้อความนิ่งค้างก่อนกล่องยุบ (ใช้กับ autoFit)
};

let updateNotifyBtnEl = null;
let updateNotifyBubbleEl = null;
let updateNotifyViewportEl = null;
let updateNotifyTrackEl = null;
let updateNotifyPrefixEl = null;
let updateNotifyActionEl = null;
let pendingUpdateData = null;

let updateNotifyMessage = "";
let updateNotifyBubbleState = "idle"; // idle | pending | open
let updateNotifyShowTimerId = null;
let updateNotifyMarqueeTimerId = null;
let updateNotifyHideTimerId = null;
let updateNotifyCleanupTimerId = null;
let updateNotifyMarqueeAnims = [];
let updateNotifyMarqueeToken = 0;

function createUpdateNotifyButton() {
    if (updateNotifyBtnEl) return;

    // กล่องข้อความ (สร้างแยกจากปุ่ม เพื่อให้ z-index ต่ำกว่าปุ่มได้จริง)
    updateNotifyBubbleEl = document.createElement("div");
    updateNotifyBubbleEl.className = "update_notify_bubble";
    updateNotifyBubbleEl.setAttribute("aria-hidden", "true");
    updateNotifyBubbleEl.style.setProperty("--update-notify-fold-ms", `${UPDATE_NOTIFY_CONFIG.foldMs}ms`);
    updateNotifyBubbleEl.innerHTML = `
        <div class="update_notify_viewport">
            <div class="update_notify_track">
                <span class="update_notify_prefix"></span>
                <span class="update_notify_action"></span>
            </div>
        </div>
    `;
   updateNotifyBubbleEl.addEventListener("click", applyPendingUpdate);

    updateNotifyViewportEl = updateNotifyBubbleEl.querySelector(".update_notify_viewport");
    updateNotifyTrackEl = updateNotifyBubbleEl.querySelector(".update_notify_track");
    updateNotifyPrefixEl = updateNotifyBubbleEl.querySelector(".update_notify_prefix");
    updateNotifyActionEl = updateNotifyBubbleEl.querySelector(".update_notify_action");

    // ตัวปุ่ม (ไม่มี title / data-update-message แล้ว)
    updateNotifyBtnEl = document.createElement("div");
    updateNotifyBtnEl.className = "update_notify_btn";
    updateNotifyBtnEl.setAttribute("role", "button");
    updateNotifyBtnEl.setAttribute("aria-label", `พบข้อมูลใหม่ ${UPDATE_NOTIFY_CONFIG.actionText}`);
    updateNotifyBtnEl.innerHTML = `
        <svg class="update_notify_icon" viewBox="0 0 24 24">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        <div class="update_notify_badge"></div>
    `;
    updateNotifyBtnEl.addEventListener("click", applyPendingUpdate);

    // hover (เมาส์/ปากกา เท่านั้น) -> เล่นซ้ำทันที ไม่มี delay
    updateNotifyBtnEl.addEventListener("pointerenter", (event) => {
        if (!UPDATE_NOTIFY_CONFIG.hoverReplay) return;
        if (event.pointerType === "touch") return;
        if (!updateNotifyBtnEl.classList.contains("show")) return;
        if (updateNotifyBubbleState !== "idle") return; // กำลังเล่น/รอเล่นอยู่ ไม่ต้องซ้ำ
        playUpdateNotifyBubble(0);
    });

    const mount = () => {
        document.body.appendChild(updateNotifyBubbleEl);
        document.body.appendChild(updateNotifyBtnEl);
    };
    if (document.body) {
        mount();
    } else {
        document.addEventListener("DOMContentLoaded", mount);
    }
}

// ---------------------------------------------------------------------------
// Update Notify: ตัววิ่ง (แยกฟังก์ชัน ปิดได้ที่ UPDATE_NOTIFY_CONFIG.marqueeEnabled)
// ---------------------------------------------------------------------------
function isNotifyMarqueeAvailable() {
    return !!UPDATE_NOTIFY_CONFIG.marqueeEnabled
        && !!updateNotifyTrackEl
        && typeof updateNotifyTrackEl.animate === "function";
}

function cancelNotifyMarqueeAnimations() {
    updateNotifyMarqueeToken++;
    updateNotifyMarqueeAnims.forEach(anim => {
        try { anim.cancel(); } catch (e) { /* ignore */ }
    });
    updateNotifyMarqueeAnims = [];
}

function stopNotifyMarquee() {
    cancelNotifyMarqueeAnimations();
    if (updateNotifyTrackEl) updateNotifyTrackEl.style.transform = "";
    if (updateNotifyBubbleEl) updateNotifyBubbleEl.classList.remove("is-scrolling"); // เพิ่มบรรทัดนี้
}

// วิ่งวน (loops - 1) รอบเต็ม แล้วรอบสุดท้ายวิ่งเข้ามาหยุดค้างที่ actionText
// (ข้อความหน้า actionText ถูกดันพ้นขอบซ้าย ไม่แสดงแม้กล่องมีที่ว่าง)
function startNotifyMarquee() {
    updateNotifyMarqueeTimerId = null;
    cancelNotifyMarqueeAnimations();
    if (!isNotifyMarqueeAvailable()) return;

    if (updateNotifyBubbleEl) updateNotifyBubbleEl.classList.add("is-scrolling"); 

    const cfg = UPDATE_NOTIFY_CONFIG;
    const viewW = updateNotifyViewportEl.clientWidth;
    const textW = updateNotifyTrackEl.offsetWidth;
    const finalX = updateNotifyActionEl.hidden ? 0 : -updateNotifyActionEl.offsetLeft;
    const loops = Math.max(1, Math.floor(cfg.marqueeLoops) || 1);

    const passes = [];
    for (let i = 0; i < loops - 1; i++) passes.push({ from: viewW, to: -textW });
    passes.push({ from: viewW, to: finalX });

    let speed = Math.max(10, Number(cfg.marqueeSpeedPxPerSec) || 90);
    if (cfg.marqueeAutoFit) {
        const totalDistance = passes.reduce((sum, p) => sum + Math.abs(p.from - p.to), 0);
        const budgetMs = cfg.displayMs - cfg.foldMs - cfg.marqueeHoldMs;
        if (budgetMs > 0 && (totalDistance / speed) * 1000 > budgetMs) {
            speed = totalDistance / (budgetMs / 1000);
        }
    }

    const token = updateNotifyMarqueeToken;
    const runPass = (index) => {
        if (token !== updateNotifyMarqueeToken) return;
        const { from, to } = passes[index];
        const isLast = index === passes.length - 1;
        const duration = Math.max(1, (Math.abs(from - to) / speed) * 1000);

        const anim = updateNotifyTrackEl.animate(
            [
                { transform: `translateX(${from}px)` },
                { transform: `translateX(${to}px)` }
            ],
            { duration, easing: "linear", fill: "forwards" }
        );
        updateNotifyMarqueeAnims.push(anim);
       
        if (!isLast) {
            anim.onfinish = () => runPass(index + 1);
        } else {
            anim.onfinish = () => {
                if (updateNotifyBubbleEl) updateNotifyBubbleEl.classList.remove("is-scrolling");
            };
        }
    };
    runPass(0);
}

// ---------------------------------------------------------------------------
// Update Notify: จังหวะการแสดงกล่องข้อความ
// ---------------------------------------------------------------------------
function splitUpdateNotifyMessage(message) {
    const action = UPDATE_NOTIFY_CONFIG.actionText;
    const text = (message || "").trim();
    if (action && text.endsWith(action)) {
        return { prefix: text.slice(0, text.length - action.length).trim(), action };
    }
    return { prefix: text, action: "" };
}

function renderUpdateNotifyText(canMarquee) {
    const { prefix, action } = splitUpdateNotifyMessage(updateNotifyMessage);
    updateNotifyPrefixEl.textContent = prefix;
    updateNotifyPrefixEl.hidden = !prefix;
    updateNotifyActionEl.textContent = action;
    updateNotifyActionEl.hidden = !action;
    updateNotifyTrackEl.style.gap = `${UPDATE_NOTIFY_CONFIG.marqueeGapPx}px`;
    updateNotifyBubbleEl.classList.toggle("is-static", !canMarquee);
}

function clearUpdateNotifyBubbleTimers() {
    [updateNotifyShowTimerId, updateNotifyMarqueeTimerId, updateNotifyHideTimerId, updateNotifyCleanupTimerId]
        .forEach(id => { if (id) clearTimeout(id); });
    updateNotifyShowTimerId = null;
    updateNotifyMarqueeTimerId = null;
    updateNotifyHideTimerId = null;
    updateNotifyCleanupTimerId = null;
}

// ยุบกล่อง (ซ้าย -> ขวา) เหลือแต่ปุ่ม
function closeUpdateNotifyBubble() {
    clearUpdateNotifyBubbleTimers();
    updateNotifyBubbleState = "idle";
    if (updateNotifyBubbleEl) updateNotifyBubbleEl.classList.remove("is-open");
    // รอให้ยุบเสร็จก่อน ค่อยหยุดตัววิ่ง (ไม่ให้ข้อความกระโดดตอนยุบ)
    updateNotifyCleanupTimerId = setTimeout(() => {
        updateNotifyCleanupTimerId = null;
        stopNotifyMarquee();
    }, UPDATE_NOTIFY_CONFIG.foldMs + 50);
}

// เล่นทั้งชุด: รอ delay -> คลี่ (ขวา -> ซ้าย) -> ตัววิ่ง -> ครบ displayMs แล้วยุบ
function playUpdateNotifyBubble(delayMs = UPDATE_NOTIFY_CONFIG.showDelayMs) {
    if (!updateNotifyBubbleEl) return;
    const cfg = UPDATE_NOTIFY_CONFIG;

    clearUpdateNotifyBubbleTimers();
    updateNotifyBubbleState = "pending";
    updateNotifyBubbleEl.classList.remove("is-open"); // ถ้าเปิดค้างอยู่ จะยุบก่อนแล้วเริ่มใหม่

    updateNotifyShowTimerId = setTimeout(() => {
        updateNotifyShowTimerId = null;

        const canMarquee = isNotifyMarqueeAvailable();
        stopNotifyMarquee();
        renderUpdateNotifyText(canMarquee);
        if (canMarquee) {
            // ให้ข้อความรออยู่นอกขอบขวา ระหว่างกล่องกำลังคลี่
            updateNotifyTrackEl.style.transform = `translateX(${updateNotifyViewportEl.clientWidth}px)`;
        }

        updateNotifyBubbleEl.classList.add("is-open");
        updateNotifyBubbleState = "open";

        if (canMarquee) {
            updateNotifyMarqueeTimerId = setTimeout(startNotifyMarquee, cfg.foldMs);
        }
        updateNotifyHideTimerId = setTimeout(closeUpdateNotifyBubble, cfg.displayMs);
    }, Math.max(0, delayMs));
}

function showUpdateNotifyButton(message) {
    if (!updateNotifyBtnEl) createUpdateNotifyButton();
    const action = UPDATE_NOTIFY_CONFIG.actionText;
    const defaultMessage = pendingAppVersion
        ? `พบแอปเวอร์ชันใหม่ (${pendingAppVersion}) ${action}`
        : `พบข้อมูลใหม่ ${action}`;

    updateNotifyMessage = message || defaultMessage;
    updateNotifyBtnEl.setAttribute("aria-label", updateNotifyMessage);
    updateNotifyBtnEl.classList.add("show");

    // เรียกซ้ำเมื่อไหร่ เริ่มเล่นใหม่ทุกครั้ง (มี delay 500ms)
    playUpdateNotifyBubble(UPDATE_NOTIFY_CONFIG.showDelayMs);
}

function hideUpdateNotifyButton() {
    closeUpdateNotifyBubble();
    if (updateNotifyBtnEl) updateNotifyBtnEl.classList.remove("show");
}

function hasTabWithMoreRowsThanBaseline(liveData, baselineRecord) {
    if (!baselineRecord) return false; 
    const tabs = ["rfa", "rfi", "letter"];
    return tabs.some(tab => {
        const oldCount = (baselineRecord[tab] || []).length;
        const newCount = (liveData[tab] || []).length;
        return newCount > oldCount;
    });
}

// ตรวจว่า tab ใดมีแถวลดลงจาก baseline (แม้แค่ 1 แถว)
// ถ้าใช่ แสดงว่า GAS กำลังอัปเดต sheet อยู่ → ข้อมูลยังไม่สมบูรณ์ → ไม่ควร apply
function hasAnyTabDecreased(liveData, baselineRecord) {
    if (!baselineRecord) return false;
    const tabs = ["rfa", "rfi", "letter"];
    return tabs.some(tab => {
        const oldCount = (baselineRecord[tab] || []).length;
        const newCount = (liveData[tab] || []).length;
        // ไม่นับ tab ที่ baseline ว่างเปล่า (ยังไม่มีข้อมูลเดิม)
        return oldCount > 0 && newCount < oldCount;
    });
}

async function applyPendingUpdate() {
    // เวอร์ชันแอปมีความสำคัญกว่าข้อมูล: reload เพื่อรับ JavaScript/CSS ชุดใหม่ก่อน
    if (pendingAppVersion) {
        const version = pendingAppVersion;
        pendingAppVersion = null;
        hideUpdateNotifyButton();
        updateAppToLatestVersion(version);
        return;
    }

    if (!pendingUpdateData) return;

    // ตรวจสอบข้อมูลซ้ำก่อน apply
    // ป้องกันกรณี GAS ยังอัปเดต sheet ไม่เสร็จในช่วงที่ผู้ใช้รอกดปุ่ม
    const baseline = await getRawCacheRecord();
    const revalidation = validateLiveDataAgainstBaseline(pendingUpdateData, baseline);
    const anyDecreased = hasAnyTabDecreased(pendingUpdateData, baseline);

    if (!revalidation.valid || anyDecreased) {
        // ข้อมูลยังไม่สมบูรณ์ → ยกเลิก apply แจ้งเตือนผู้ใช้แทน
        pendingUpdateData = null;
        hideUpdateNotifyButton();
        const reasons = anyDecreased
            ? ["ข้อมูลบางชีทยังอัปเดตไม่เสร็จ ระบบจะรอตรวจสอบรอบถัดไปโดยอัตโนมัติ"]
            : revalidation.reasons;
        showDataWarningBanner(reasons);
        return;
    }

    hideUpdateNotifyButton();

    DOCUMENTS_BY_TAB.rfa = pendingUpdateData.rfa;
    DOCUMENTS_BY_TAB.rfi = pendingUpdateData.rfi;
    DOCUMENTS_BY_TAB.letter = pendingUpdateData.letter;
    pendingUpdateData = null;

    await saveToCache(); 
    window.location.reload();
}

// ---------------------------------------------------------------------------
// Background Cache Check 
// ---------------------------------------------------------------------------
let backgroundCheckIntervalId = null;
let appHasEverLoadedData = false;
let appVersionCheckIntervalId = null;

function startAppVersionChecks() {
    if (appVersionCheckIntervalId) return;
    appVersionCheckIntervalId = setInterval(() => {
        if (!document.hidden) checkForAppVersionUpdate();
    }, APP_VERSION_CHECK_INTERVAL_MS);
}

function stopAppVersionChecks() {
    if (!appVersionCheckIntervalId) return;
    clearInterval(appVersionCheckIntervalId);
    appVersionCheckIntervalId = null;
}

function startBackgroundCacheCheck() {
    stopBackgroundCacheCheck();
    backgroundCheckIntervalId = setInterval(() => {
        if (document.hidden) return;
        performBackgroundCheck();
    }, CACHE_DURATION_MS);
}

function stopBackgroundCacheCheck() {
    if (backgroundCheckIntervalId) {
        clearInterval(backgroundCheckIntervalId);
        backgroundCheckIntervalId = null;
    }
}


async function performBackgroundCheck() {
    if (document.hidden) return;

    const liveResult = await fetchLiveGoogleSheets();
    const baselineRecord = await getRawCacheRecord();

    if (liveResult.success && liveResult.totalRows > 0) {
        const validation = validateLiveDataAgainstBaseline(liveResult.data, baselineRecord);

        if (validation.valid) {
            // ตรวจว่า tab ใดมีแถวลดลงจาก baseline ก่อน (บ่งชี้ว่า GAS กำลังอัปเดต sheet อยู่)
            // ถ้าใช่ → ข้อมูลยังไม่สมบูรณ์ → ไม่ show notify / ไม่ apply → รอรอบถัดไป
            if (hasAnyTabDecreased(liveResult.data, baselineRecord)) {
                showDataWarningBanner([
                    "ตรวจพบข้อมูลบางชีทมีจำนวนรายการลดลงชั่วคราว (อาจกำลังอัปเดตอยู่) ระบบจะรอตรวจสอบรอบถัดไป"
                ]);
            } else if (hasTabWithMoreRowsThanBaseline(liveResult.data, baselineRecord)) {
                pendingUpdateData = liveResult.data;
                showUpdateNotifyButton();
            } else {
                DOCUMENTS_BY_TAB.rfa = liveResult.data.rfa;
                DOCUMENTS_BY_TAB.rfi = liveResult.data.rfi;
                DOCUMENTS_BY_TAB.letter = liveResult.data.letter;

                const fetchTime = Date.now();
                await saveToCache();
                updateCacheStatusUI(formatTimestampTo24H(fetchTime));
                hideDataWarningBanner();

                if (!appHasEverLoadedData) {
                    appHasEverLoadedData = true;
                    hideNoDataState();
                    startApp(currentTab || "rfa");
                } else {
                    if (typeof updateTabBadges === "function") updateTabBadges();
                    if (typeof filterActiveTabDocuments === "function") filterActiveTabDocuments();
                }
            }
        } else {
            showDataWarningBanner(validation.reasons);
        }
    } else if (appHasEverLoadedData) {
        showDataWarningBanner(["ไม่สามารถเชื่อมต่อ Google Sheets ได้ในการตรวจสอบล่าสุด ระบบยังคงแสดงข้อมูลชุดก่อนหน้าไว้"]);
    }
    
    await runCacheDiagnostic();
}

// [แก้ไขใหม่] เพิ่มการตรวจสอบ Session Guard ตอนกลับมาโฟกัสหน้าต่าง
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopBackgroundCacheCheck();
        stopAppVersionChecks();
    } else if (appHasEverLoadedData || document.getElementById("noDataBox")) {
        startBackgroundCacheCheck();
        startAppVersionChecks();
        performBackgroundCheck(); 
        checkForAppVersionUpdate(true);
        
        // ตรวจสอบ Session Guard ทุกครั้งที่กลับมา Focus
        if (Date.now() - window.lastVerifiedAt > window.REVALIDATE_INTERVAL_MS) {
            window.verifyStatus(); // ถ้าโดนแบน จะเคลียร์และเด้งออกเองในฟังก์ชัน
        }
    }
});

async function initAppFlow(forceRefresh = false) {
    if (!chartTheme) chartTheme = buildChartTheme();

    const splashStatus = document.getElementById("splashStatus");

    if (!forceRefresh) {
        const cachedData = await loadFromCache();
        if (cachedData) {
            DOCUMENTS_BY_TAB.rfa = cachedData.rfa || [];
            DOCUMENTS_BY_TAB.rfi = cachedData.rfi || [];
            DOCUMENTS_BY_TAB.letter = cachedData.letter || [];

            hideLoadProgressUI(); 
            hideDataWarningBanner();
            hideNoDataState();
            appHasEverLoadedData = true;
            updateCacheStatusUI(formatTimestampTo24H(cachedData.timestamp));
            if (splashStatus) splashStatus.textContent = "กำลังเตรียมแสดงข้อมูล (Cache)...";

            startApp(currentTab || "rfa");
            startBackgroundCacheCheck();
            await runCacheDiagnostic();
            return;
        }
    }

    if (splashStatus) splashStatus.textContent = "กำลังดึงข้อมูลใหม่จาก Google Sheets...";

    const liveResult = await fetchLiveGoogleSheets();
    const baselineRecord = await getRawCacheRecord(); 

    if (liveResult.success && liveResult.totalRows > 0) {
        // เมื่อ forceRefresh=true ให้ข้ามการเปรียบกับ baseline เดิม
        // เพราะ cache อาจเสียอยู่ (มีข้อมูลผิดบันทึกไว้) → ใช้ live data ตรงๆ
        // แต่ยังตรวจ hasAnyTabDecreased เพื่อป้องกันกรณี sheet กำลัง update อยู่จริง
        const skipBaseline = forceRefresh;
        const validation = skipBaseline
            ? { valid: true, reasons: [] }
            : validateLiveDataAgainstBaseline(liveResult.data, baselineRecord);

        const anyDecreased = hasAnyTabDecreased(liveResult.data, baselineRecord);

        if ((validation.valid && !anyDecreased) || skipBaseline) {
            DOCUMENTS_BY_TAB.rfa = liveResult.data.rfa;
            DOCUMENTS_BY_TAB.rfi = liveResult.data.rfi;
            DOCUMENTS_BY_TAB.letter = liveResult.data.letter;

            const fetchTime = Date.now();
            await saveToCache();
            updateCacheStatusUI(formatTimestampTo24H(fetchTime));
            hideDataWarningBanner();
            hideNoDataState();
            appHasEverLoadedData = true;
            startApp(currentTab || "rfa");
        } else if (baselineRecord) {
            DOCUMENTS_BY_TAB.rfa = baselineRecord.rfa || [];
            DOCUMENTS_BY_TAB.rfi = baselineRecord.rfi || [];
            DOCUMENTS_BY_TAB.letter = baselineRecord.letter || [];

            updateCacheStatusUI(formatTimestampTo24H(baselineRecord.timestamp));
            const reasons = anyDecreased
                ? ["ตรวจพบข้อมูลบางชีทมีจำนวนรายการลดลงชั่วคราว (อาจกำลังอัปเดตอยู่) ระบบแสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน", ...validation.reasons]
                : validation.reasons;
            showDataWarningBanner(reasons);
            hideNoDataState();
            appHasEverLoadedData = true;
            startApp(currentTab || "rfa");
        } else {
            hideLoadProgressUI();
            showNoDataState();
            appHasEverLoadedData = false;
            if (splashStatus) splashStatus.textContent = "ไม่พบข้อมูล";
            updateCacheStatusUI("ไม่สามารถเชื่อมต่อฐานข้อมูลได้");
            startApp(currentTab || "rfa");
        }
    } else if (baselineRecord) {
        DOCUMENTS_BY_TAB.rfa = baselineRecord.rfa || [];
        DOCUMENTS_BY_TAB.rfi = baselineRecord.rfi || [];
        DOCUMENTS_BY_TAB.letter = baselineRecord.letter || [];

        updateCacheStatusUI(formatTimestampTo24H(baselineRecord.timestamp));
        showDataWarningBanner(["ไม่สามารถเชื่อมต่อ Google Sheets ได้ ระบบแสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน"]);
        hideNoDataState();
        appHasEverLoadedData = true;
        startApp(currentTab || "rfa");
    } else {
        hideLoadProgressUI();
        showNoDataState();
        appHasEverLoadedData = false;
        if (splashStatus) splashStatus.textContent = "ไม่พบข้อมูล";
        updateCacheStatusUI("ไม่สามารถเชื่อมต่อฐานข้อมูลได้");
        startApp(currentTab || "rfa");
    }

    startBackgroundCacheCheck(); 
    await runCacheDiagnostic(); 
}

// ---------------------------------------------------------------------------
// Date Helpers
// ---------------------------------------------------------------------------
function parseUpdateDateToDate(dateStr) {
    if (!dateStr || dateStr === "-") return null;
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) return null;

    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    let year = parseInt(dateParts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

    year = year < 100 ? 2000 + year : year;
    const parsedDate = new Date(year, month - 1, day);
    return isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getLatestUpdateDate(docs) {
    if (!docs || docs.length === 0) return "-";

    let latestDateObj = null;
    let latestDateStr = "-";

    docs.forEach(doc => {
        const dateObj = parseUpdateDateToDate(doc.updateDate);
        if (dateObj && (!latestDateObj || dateObj > latestDateObj)) {
            latestDateObj = dateObj;
            latestDateStr = doc.updateDate;
        }
    });

    return latestDateStr;
}

function updateLatestDateDisplay() {
    const globalLatestEl = document.getElementById("globalLatestUpdate");
    if (globalLatestEl) {
        globalLatestEl.textContent = getLatestUpdateDate(activeDocuments);
    }
}
