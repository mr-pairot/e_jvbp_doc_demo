/* data-service.js — ระบบสารบรรณอิเล็กทรอนิกส์
   จุดเริ่มต้นการทำงานของแอป (Bootstrap) + การดึงและแปลงข้อมูลจาก Google Sheets + ระบบ Cache

   ต้องโหลดหลัง config.js (ใช้ SPREADSHEET_ID, DOCUMENTS_BY_TAB, buildChartTheme,
   toDisplayString, APP_CACHE_VERSION) และก่อน ui-render.js เพราะ initAppFlow()
   จะเรียก switchTab() ซึ่งนิยามอยู่ใน ui-render.js

   หมายเหตุสำคัญเรื่อง Bootstrap (แก้ไขจากเดิม):
   ฟังก์ชันเริ่มต้นของแอปหลัก "ไม่" ผูกกับ document.addEventListener("DOMContentLoaded", ...)
   อีกต่อไป เพราะไฟล์นี้ถูกโหลดแบบ dynamic (ผ่าน loadAppAssets() ใน auth.js) หลัง
   login สำเร็จ ซึ่งเกิดขึ้น "หลังจาก" DOMContentLoaded ตัวจริงของหน้าเว็บได้ยิง
   ไปแล้วเสมอ (มันยิงครั้งเดียวตอน parse HTML เริ่มต้นเสร็จ) — ถ้ายังผูกกับ
   event นี้อยู่ ฟังก์ชันเหล่านี้จะไม่มีวันถูกเรียกเลยหลัง login

   แทนที่ด้วยการ expose เป็น window.initDashboardApp แล้วให้ auth.js เรียกตรงๆ
   ใน showApp() ทันทีหลัง loadAppAssets() โหลดสคริปต์ทุกไฟล์ (รวม ui-render.js
   ซึ่ง initAppFlow() ต้องใช้ฟังก์ชัน switchTab จากไฟล์นั้น) เสร็จเรียบร้อยแล้ว
   จึงการันตีได้ว่า switchTab, ui-render อื่นๆ ถูกนิยามพร้อมใช้งานแล้วแน่นอน

   หมวดหมู่ในไฟล์นี้:
     1. Bootstrap (window.initDashboardApp / window.startApp)
     2. IndexedDB Wrapper (เปิด DB / อ่าน-เขียนข้อมูลพื้นฐาน)
     3. Cache Management & Force Refresh (ระบบแคชและปุ่มรีเฟรช)
     4. Cache Diagnostic Report (รายงานตรวจสอบระบบแคชแบบแสดงผลบนหน้าจอ)
     5. Data Fetching & Parsing (ดึงและแปลงข้อมูลจาก Google Sheets)
     6. Update Notify Button (แจ้งเตือนเมื่อพบข้อมูลใหม่ที่มีจำนวนแถวมากกว่าเดิม)
     7. Date Helpers (แปลง/เปรียบเทียบวันที่ Update ล่าสุด)

   ========================================================================= */

// ---------------------------------------------------------------------------
// 1. Bootstrap
// ---------------------------------------------------------------------------

// เรียกจาก auth.js -> showApp() ทันทีหลัง loadAppAssets() โหลดสคริปต์ทุกไฟล์
// (รวม ui-render.js/about-popup.js) เสร็จสมบูรณ์แล้วเท่านั้น
window.initDashboardApp = function () {
    initPaginationButtons();
    initCacheEvents(); // ผูก Event สำหรับปุ่ม Force Refresh
    initDiagnosticToggle(); // ผูก Event สำหรับปุ่มซ่อน/แสดงรายงานตรวจสอบแคช
    createUpdateNotifyButton(); // สร้างปุ่มแจ้งเตือนข้อมูลใหม่ไว้ล่วงหน้า (ยังซ่อนอยู่จนกว่าจะพบข้อมูลใหม่)
    initAppFlow();
};

window.startApp = function (tabId) {
    const splashScreen = document.getElementById("splashScreen");
    splashScreen.classList.add("is-fading-out");

    // ข้อมูลพร้อมแสดงผลแล้ว ณ จุดนี้ (จุดเดียวในทั้งแอปที่ตัดสินใจซ่อน splash จริง)
    // -> หยุด ring animation background ของ splash และคืนทรัพยากร GPU/battery
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
const CACHE_KEY = "BPNP_DOC_CACHE"; // ใช้เป็น record id ภายใน object store

let idbPromiseSingleton = null;

// เปิดการเชื่อมต่อ IndexedDB (ทำครั้งเดียวแล้วเก็บ Promise ไว้ใช้ซ้ำ)
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

// บันทึกข้อมูลลง object store (record ต้องมี field "id" ตรงกับ keyPath)
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

// อ่านข้อมูลจาก object store ด้วย id
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
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 นาที (หน่วยเป็นมิลลิวินาที)

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

// เก็บผลลัพธ์ล่าสุดของการ save/load cache ไว้สำหรับแสดงในรายงานตรวจสอบ
const cacheDiagnosticState = {
    lastSaveOk: null,      // true / false / null (ยังไม่เคย save)
    lastSaveError: null,   // ข้อความ error ถ้ามี
    lastSaveSizeBytes: 0,  // ขนาดข้อมูลล่าสุดที่พยายามบันทึก (ไบต์)
    lastLoadOk: null,      // true / false / null (ยังไม่เคย load)
    lastLoadError: null,
    lastLoadReason: ""     // เหตุผลที่ loadFromCache คืนค่า null (ไม่มี record / หมดอายุ / version ไม่ตรง / error)
};

async function saveToCache() {
    const cacheData = {
        timestamp: Date.now(),
        version: APP_CACHE_VERSION, // แนบเวอร์ชันปัจจุบันของแอปไปกับข้อมูลที่บันทึก
        rfa: DOCUMENTS_BY_TAB.rfa,
        rfi: DOCUMENTS_BY_TAB.rfi,
        letter: DOCUMENTS_BY_TAB.letter
    };
    try {
        // ใช้ JSON.stringify เฉพาะเพื่อประมาณขนาดข้อมูล (สำหรับรายงาน) ไม่ได้ใช้เก็บจริง
        cacheDiagnosticState.lastSaveSizeBytes = new Blob([JSON.stringify(cacheData)]).size;

        await idbPut(CACHE_KEY, cacheData);

        cacheDiagnosticState.lastSaveOk = true;
        cacheDiagnosticState.lastSaveError = null;
    } catch (e) {
        console.warn("ไม่สามารถบันทึก Cache ลง IndexedDB ได้:", e);
        cacheDiagnosticState.lastSaveOk = false;
        cacheDiagnosticState.lastSaveError = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
    }
    await runCacheDiagnostic(); // อัปเดตรายงานบนจอทุกครั้งหลังพยายามบันทึก
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

        // เช็ค version ก่อนเช็คอายุ: ถ้าไม่ตรงกับแอปปัจจุบัน (รวมถึง record เก่าที่ไม่มี field นี้)
        // ให้ถือว่า cache ใช้ไม่ได้ทันที ไม่ว่าจะเพิ่งบันทึกไปกี่วินาทีก็ตาม (กันโครงสร้างข้อมูลเก่าค้าง)
        if (record.version !== APP_CACHE_VERSION) {
            cacheDiagnosticState.lastLoadOk = false;
            cacheDiagnosticState.lastLoadError = null;
            cacheDiagnosticState.lastLoadReason = `พบแคชแต่ version ไม่ตรง (แคชเป็น v${record.version ?? "ไม่ทราบ"}, แอปปัจจุบันคือ v${APP_CACHE_VERSION}) → บังคับดึงข้อมูลใหม่`;
            await runCacheDiagnostic();
            return null;
        }

        const now = Date.now();
        const ageMs = now - record.timestamp;

        // ถ้าอายุน้อยกว่า 15 นาที ถือว่า Cache ยังใช้งานได้
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
        return null; // หมดอายุ
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
            // แสดง Splash Screen อีกครั้ง
            const splashScreen = document.getElementById("splashScreen");
            const splashStatus = document.getElementById("splashStatus");
            splashScreen.classList.remove("is-hidden", "is-fading-out");
            if (splashStatus) splashStatus.textContent = "กำลังอัปเดตข้อมูลจากฐานข้อมูล...";

            // Splash โผล่ขึ้นมาอีกครั้ง -> รัน ring background ซ้ำ (ถูกทำลายไปแล้ว
            // ตอนโหลดข้อมูลครั้งก่อนใน startApp()) ให้ผู้ใช้เห็น animation
            // ระหว่างรอข้อมูลใหม่รอบนี้ด้วยเช่นกัน
            if (typeof window.startMagicRingsBg === "function") window.startMagicRingsBg();

            // บังคับดึงข้อมูลใหม่ (ส่งค่า true)
            await initAppFlow(true);
        });
    }
}

// ---------------------------------------------------------------------------
// Cache Diagnostic Report (รายงานตรวจสอบระบบแคช — แสดงผลบนหน้าจอโดยตรง
// เพื่อใช้ตรวจสอบบนอุปกรณ์ที่เปิด DevTools ไม่ได้ เช่น แท็บเล็ต/มือถือ/WebView)
// ---------------------------------------------------------------------------

// ทดสอบว่า IndexedDB ใช้งานได้จริงหรือไม่ ในบริบทปัจจุบัน
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

// อ่านสถานะปัจจุบันของ record แคชตรงจาก IndexedDB (แบบ read-only ไม่แก้ค่าใดๆ)
// เพื่อให้รายงานตรงกับสิ่งที่เก็บอยู่จริง ณ ขณะนั้น
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

// ขอข้อมูลโควตาพื้นที่จัดเก็บโดยรวมของ origin นี้ (ถ้าเบราว์เซอร์รองรับ)
// ช่วยให้เห็นภาพว่าเหลือพื้นที่เท่าไหร่ ใช้ไปเท่าไหร่ทั้ง IndexedDB/localStorage รวมกัน
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

// ฟังก์ชันหลัก: รวบรวมผลตรวจสอบทั้งหมดแล้ว render เป็น HTML ลงในกล่องรายงานบนหน้าจอ
async function runCacheDiagnostic() {
    const box = document.getElementById("cacheDiagnosticBox");
    const content = document.getElementById("cacheDiagnosticContent");
    if (!box || !content) return;

    const storageTest = await testIndexedDBAvailability();
    const cacheInfo = await inspectCacheRecord();
    const storageEstimate = await getStorageEstimate();

    const lines = [];

    // 1) IndexedDB ใช้งานได้ไหม
    lines.push({
        label: "IndexedDB ใช้งานได้",
        value: storageTest.available ? "✅ ใช้งานได้ปกติ" : `❌ ใช้งานไม่ได้ (${storageTest.error})`,
        warn: !storageTest.available
    });

    // 2) มี record แคชอยู่ไหม
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

    // 3) ผลลัพธ์การพยายาม "บันทึก" ครั้งล่าสุดในเซสชันนี้
    if (cacheDiagnosticState.lastSaveOk !== null) {
        lines.push({
            label: "ผลบันทึกแคชล่าสุด (ครั้งนี้)",
            value: cacheDiagnosticState.lastSaveOk
                ? `✅ บันทึกสำเร็จ (${formatBytes(cacheDiagnosticState.lastSaveSizeBytes)})`
                : `❌ บันทึกล้มเหลว: ${cacheDiagnosticState.lastSaveError}`,
            warn: !cacheDiagnosticState.lastSaveOk
        });
    }

    // 4) ผลลัพธ์การพยายาม "อ่าน" ครั้งล่าสุดในเซสชันนี้
    if (cacheDiagnosticState.lastLoadReason) {
        lines.push({
            label: "ผลอ่านแคชล่าสุด (ครั้งนี้)",
            value: (cacheDiagnosticState.lastLoadOk ? "✅ " : "ℹ️ ") + cacheDiagnosticState.lastLoadReason +
                   (cacheDiagnosticState.lastLoadError ? ` (error: ${cacheDiagnosticState.lastLoadError})` : ""),
            warn: cacheDiagnosticState.lastLoadError !== null
        });
    }

    // 5) โควตาพื้นที่จัดเก็บโดยรวมของ origin (ถ้าเบราว์เซอร์รองรับ)
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

    // 6) User Agent / โหมดเบราว์เซอร์ (ช่วยดูว่าเป็น private mode / webview หรือไม่)
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
        // --- Fallback: step-based progress ---
        if (onProgress) onProgress(0);
        const text = await res.text();
        if (onProgress) onProgress(100);
        return parseGvizResponseText(text);
    }

    // --- แนวทางหลัก: byte-based progress ---
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
    resultText += decoder.decode(); // flush ตัวอักษรที่ค้างอยู่ใน decoder buffer
    if (onProgress) onProgress(100);

    return parseGvizResponseText(resultText);
}

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

    // 1) Extract Cx Code จากวงเล็บแรก (สำหรับ Bar Chart)
    let cxCode = "Others";
    const cxMatch = title.match(/\(([^)]+)\)/);
    if (cxMatch) {
        cxCode = cxMatch[1].trim();
    }

    // 2) Extract Parsed Code จากชื่อไฟล์
    let parsedCode = "Others";
    const dashParts = title.split('-');

    // ค้นหาตำแหน่ง (Index) ของก้อนที่มีคำว่า SUB หรือ DWG
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

    // 3) แปลงวันที่อัปเดต
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

    // กำหนดหมวดงาน (Category) จาก 3 ตัวอักษรสุดท้ายของ parsedCode
    let docCategory = category;
    if (parsedCode && parsedCode.length >= 3) {
        const suffix = parsedCode.slice(-3).toUpperCase();
        if (suffix === "SUB" || suffix === "DWG") {
            docCategory = suffix;
        } else {
            docCategory = "อื่นๆ"; // ถ้าไม่ใช่ SUB หรือ DWG ให้ปัดเข้าหมวดอื่นๆ
        }
    } else {
        docCategory = "อื่นๆ";
    }

    return {
        id,
        folderName: toDisplayString(rowObj.c[0]?.v),
        pathCode: toDisplayString(rowObj.c[1]?.v),
        parsedCode,
        cxCode,
        title,
        fileName,
        link: toDisplayString(rowObj.c[3]?.v),
        updateDate,
        category: docCategory
    };
}

// ฟังก์ชันสำหรับ Parse ข้อมูลชีท Letter
function parseLetterRowToDoc(rowObj, id) {
    if (!rowObj.c) return null;

    // วันที่ Update = คอลัมน์ F (Index 5)
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

    return {
        id,
        parsedCode: toDisplayString(rowObj.c[0]?.v), // คอลัมน์ A (Index 0) = ที่มา
        receiveNo: toDisplayString(rowObj.c[1]?.v),  // คอลัมน์ B (Index 1) = เลขรับ
        letterNo: toDisplayString(rowObj.c[2]?.v),   // คอลัมน์ C (Index 2) = เลขหนังสือ
        title: toDisplayString(rowObj.c[3]?.v),      // คอลัมน์ D (Index 3) = ชื่อเรื่อง
        link: toDisplayString(rowObj.c[4]?.v),       // คอลัมน์ E (Index 4) = ลิงก์เอกสาร
        updateDate: updateDate,                      // คอลัมน์ F (Index 5) = วันที่ Update
        category: "Letter"
    };
}

// ---------------------------------------------------------------------------
// Splash Progress Bar UI (แสดงความคืบหน้าการโหลดข้อมูลบนหน้า splash)
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
            const overallPct = avgPct * 0.9; // ขั้นตอน fetch กินสัดส่วน 0-90% ของแถบรวม
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

        // Loop ของ Letter
        letterRows.forEach(row => {
            const doc = parseLetterRowToDoc(row, idCounter++);
            // เช็คว่าไม่ใช่บรรทัดว่าง
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
// Data Validation (ตรวจสอบว่าข้อมูลสดที่ดึงมาผิดปกติหรือไม่ เทียบกับแคชเดิม)
// ---------------------------------------------------------------------------
const DATA_DROP_THRESHOLD_RATIO = 0.20;   // ถือว่าผิดปกติถ้าจำนวนแถวลดลงเกิน 20%
const DATA_MIN_BASELINE_ROWS = 5;         // เริ่มเช็คสัดส่วน % เฉพาะ tab ที่แคชเดิมมี >= 5 แถว
const TAB_LABELS_TH = { rfa: "RFA", rfi: "RFI", letter: "Letter In" };

// อ่าน record แคชดิบจาก IndexedDB ตรงๆ แบบไม่สนใจว่าหมดอายุหรือยัง
// ใช้เป็น "baseline" สำหรับเทียบกับข้อมูลสดที่เพิ่งดึงมา
async function getRawCacheRecord() {
    try {
        return await idbGet(CACHE_KEY);
    } catch (e) {
        return null;
    }
}

// เทียบข้อมูลสด (liveData: {rfa,rfi,letter}) กับแคชเดิม (baselineRecord หรือ null ถ้าไม่มี)
// คืนค่า { valid, reasons: string[] }
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

        if (oldCount === 0) return; // เดิมก็ไม่มีข้อมูล ไม่มีอะไรให้เทียบ

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
// Data Warning Banner (แถบเหลืองเตือนข้อมูลผิดปกติ — ระหว่าง header กับตาราง)
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
// No Data State (กรณีไม่มีข้อมูลใดๆ เลย ไม่มีแคชสำรองให้ใช้)
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
let updateNotifyBtnEl = null;
let pendingUpdateData = null; // { rfa, rfi, letter } ที่ fetch มาแล้ว รอผู้ใช้กดยืนยัน

function createUpdateNotifyButton() {
    if (updateNotifyBtnEl) return;

    updateNotifyBtnEl = document.createElement("div");
    updateNotifyBtnEl.className = "update_notify_btn";
    updateNotifyBtnEl.title = "พบข้อมูลใหม่ แตะเพื่ออัปเดต";
    updateNotifyBtnEl.innerHTML = `
        <svg class="update_notify_icon" viewBox="0 0 24 24">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        <div class="update_notify_badge"></div>
    `;
    updateNotifyBtnEl.addEventListener("click", applyPendingUpdate);

    if (document.body) {
        document.body.appendChild(updateNotifyBtnEl);
    } else {
        document.addEventListener("DOMContentLoaded", () => document.body.appendChild(updateNotifyBtnEl));
    }
}

function showUpdateNotifyButton() {
    if (!updateNotifyBtnEl) createUpdateNotifyButton();
    updateNotifyBtnEl.classList.add("show");
}

function hideUpdateNotifyButton() {
    if (updateNotifyBtnEl) updateNotifyBtnEl.classList.remove("show");
}

// เทียบจำนวนแถวของข้อมูลสดที่เพิ่ง fetch มา กับ cache ล่าสุดใน IndexedDB (baselineRecord)
// คืนค่า true ถ้ามี "แท็บใดแท็บหนึ่ง" ที่จำนวนแถวมากกว่าเดิม
function hasTabWithMoreRowsThanBaseline(liveData, baselineRecord) {
    if (!baselineRecord) return false; // ไม่มี baseline ให้เทียบ -> ปล่อยให้ apply เงียบไปตามปกติ
    const tabs = ["rfa", "rfi", "letter"];
    return tabs.some(tab => {
        const oldCount = (baselineRecord[tab] || []).length;
        const newCount = (liveData[tab] || []).length;
        return newCount > oldCount;
    });
}

// ผู้ใช้กดปุ่ม badge -> apply ข้อมูลที่ fetch ไว้แล้ว บันทึกลง cache แล้ว reload หน้าทันที
async function applyPendingUpdate() {
    if (!pendingUpdateData) return;
    hideUpdateNotifyButton();

    DOCUMENTS_BY_TAB.rfa = pendingUpdateData.rfa;
    DOCUMENTS_BY_TAB.rfi = pendingUpdateData.rfi;
    DOCUMENTS_BY_TAB.letter = pendingUpdateData.letter;
    pendingUpdateData = null;

    await saveToCache(); // บันทึกชุดข้อมูลใหม่ + timestamp/version ปัจจุบันลง IndexedDB ก่อน reload
    window.location.reload();
}

// ---------------------------------------------------------------------------
// Background Cache Check (แอบตรวจสอบข้อมูลใหม่ทุก 15 นาทีขณะผู้ใช้เปิดหน้าค้างไว้
// และตรวจสอบทันทีเมื่อกลับมาโฟกัสหน้าต่างอีกครั้ง)
// หยุดตรวจสอบเมื่อแท็บ/หน้าต่างไม่ได้ถูกโฟกัส (document.hidden) และเริ่มนับ 15 นาที
// ใหม่ทุกครั้งที่กลับมาโฟกัส (ไม่นับเวลาที่พักหน้าต่างไว้)
// ---------------------------------------------------------------------------
let backgroundCheckIntervalId = null;
let appHasEverLoadedData = false;

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
            if (hasTabWithMoreRowsThanBaseline(liveResult.data, baselineRecord)) {
                // พบข้อมูลใหม่มากกว่าเดิม -> เก็บรอไว้ ไม่ apply ทันที ไม่รบกวนสิ่งที่ผู้ใช้กำลังดู/กรอง/ค้นหาอยู่
                pendingUpdateData = liveResult.data;
                showUpdateNotifyButton();
            } else {
                // จำนวนแถวเท่าเดิมหรือน้อยกว่า (แต่ validation ผ่าน) -> apply เงียบๆ ตามเดิม ไม่ต้องแจ้งเตือน
                DOCUMENTS_BY_TAB.rfa = liveResult.data.rfa;
                DOCUMENTS_BY_TAB.rfi = liveResult.data.rfi;
                DOCUMENTS_BY_TAB.letter = liveResult.data.letter;

                const fetchTime = Date.now();
                await saveToCache();
                updateCacheStatusUI(formatTimestampTo24H(fetchTime));
                hideDataWarningBanner();

                if (!appHasEverLoadedData) {
                    // กู้กลับจากสถานะ "ไม่พบข้อมูล" เป็นครั้งแรก -> ต้องเริ่ม UI เต็มรูปแบบ
                    appHasEverLoadedData = true;
                    hideNoDataState();
                    startApp(currentTab || "rfa");
                } else {
                    // เคยแสดงข้อมูลอยู่แล้ว -> รีเฟรชเฉพาะข้อมูล คงตัวกรอง/หน้าเพจ/แท็บที่เปิดอยู่ไว้
                    if (typeof updateTabBadges === "function") updateTabBadges();
                    if (typeof filterActiveTabDocuments === "function") filterActiveTabDocuments();
                }
            }
        } else {
            // ข้อมูลสดผิดปกติ -> ไม่แตะ DOCUMENTS_BY_TAB / ไม่บันทึกแคชทับ คงข้อมูลเดิมที่แสดงอยู่ไว้
            showDataWarningBanner(validation.reasons);
        }
    } else if (appHasEverLoadedData) {
        // เชื่อมต่อไม่สำเร็จตอนตรวจสอบเงียบๆ (มีข้อมูลแสดงอยู่แล้วก่อนหน้า) -> แค่เตือน ไม่รบกวนข้อมูลที่แสดงอยู่
        showDataWarningBanner(["ไม่สามารถเชื่อมต่อ Google Sheets ได้ในการตรวจสอบล่าสุด ระบบยังคงแสดงข้อมูลชุดก่อนหน้าไว้"]);
    }
    // หมายเหตุ: ถ้ายังไม่เคยมีข้อมูลเลย (appHasEverLoadedData = false) และรอบนี้ก็ยังดึงไม่สำเร็จ
    // จะปล่อยผ่านเงียบๆ โดยไม่รบกวนผู้ใช้ซ้ำ (สถานะ "ไม่พบข้อมูล" ที่ค้างอยู่แล้วสื่อสารเพียงพอ)

    await runCacheDiagnostic();
}

// พักการตรวจสอบพื้นหลังเมื่อผู้ใช้สลับออกจากแท็บ/พักหน้าต่าง แล้วเริ่มนับ 15 นาทีใหม่
// ตั้งแต่ตอนที่กลับมาโฟกัสอีกครั้ง (ไม่นับเวลาที่พักหน้าต่างไว้รวมเข้าไปด้วย)
// และตรวจสอบข้อมูลใหม่ทันทีเมื่อกลับมาโฟกัส ไม่ต้องรอครบรอบ 15 นาที
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopBackgroundCacheCheck();
    } else if (appHasEverLoadedData || document.getElementById("noDataBox")) {
        // เริ่มนับใหม่ทุกครั้งที่กลับมาโฟกัส ไม่ว่าจะเคยมีข้อมูลหรือกำลังอยู่ในสถานะ "ไม่พบข้อมูล"
        // (เผื่อกรณี Google Sheets กลับมาใช้งานได้แล้วระหว่างที่ผู้ใช้พักหน้าต่างไว้)
        startBackgroundCacheCheck();
        performBackgroundCheck(); // เช็คทันทีตอนกลับมาโฟกัส ไม่ต้องรอครบรอบ 15 นาที
    }
});

// ฟังก์ชันหลักที่เริ่มทำงาน (เพิ่ม Parameter forceRefresh เพื่อรองรับระบบ Cache)
async function initAppFlow(forceRefresh = false) {
    if (!chartTheme) chartTheme = buildChartTheme();

    const splashStatus = document.getElementById("splashStatus");

    // 1. ตรวจสอบ Cache หากไม่ได้ถูกสั่งบังคับรีเฟรช
    if (!forceRefresh) {
        const cachedData = await loadFromCache();
        if (cachedData) {
            // โหลดข้อมูลจากแคช
            DOCUMENTS_BY_TAB.rfa = cachedData.rfa || [];
            DOCUMENTS_BY_TAB.rfi = cachedData.rfi || [];
            DOCUMENTS_BY_TAB.letter = cachedData.letter || [];

            hideLoadProgressUI(); // เส้นทาง Cache ไม่มีการดึงข้อมูล จึงไม่ต้องโชว์แถบความคืบหน้า
            hideDataWarningBanner();
            hideNoDataState();
            appHasEverLoadedData = true;
            updateCacheStatusUI(formatTimestampTo24H(cachedData.timestamp));
            if (splashStatus) splashStatus.textContent = "กำลังเตรียมแสดงข้อมูล (Cache)...";

            // เริ่มการทำงาน (ถ้าเป็นการเข้ามาครั้งแรกใช้ rfa, ถ้ารีเฟรชระหว่างใช้งานให้ใช้แท็บปัจจุบัน)
            startApp(currentTab || "rfa");
            startBackgroundCacheCheck();
            await runCacheDiagnostic();
            return;
        }
    }

    // 2. ถ้า Cache หมดอายุ, version ไม่ตรง, ไม่มี Cache หรือกดปุ่ม Force Refresh -> ดึงจากชีท
    if (splashStatus) splashStatus.textContent = "กำลังดึงข้อมูลใหม่จาก Google Sheets...";

    const liveResult = await fetchLiveGoogleSheets();
    const baselineRecord = await getRawCacheRecord(); // baseline แบบไม่สนอายุ/version ใช้เทียบเท่านั้น

    if (liveResult.success && liveResult.totalRows > 0) {
        const validation = validateLiveDataAgainstBaseline(liveResult.data, baselineRecord);

        if (validation.valid) {
            // ข้อมูลสดผ่านเกณฑ์ -> ใช้งานได้ตามปกติ
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
            // ข้อมูลสดผิดปกติ แต่ยังมีแคชเดิมให้ใช้แทนได้ -> fallback ไปแคช พร้อมแจ้งเตือน
            DOCUMENTS_BY_TAB.rfa = baselineRecord.rfa || [];
            DOCUMENTS_BY_TAB.rfi = baselineRecord.rfi || [];
            DOCUMENTS_BY_TAB.letter = baselineRecord.letter || [];

            updateCacheStatusUI(formatTimestampTo24H(baselineRecord.timestamp));
            showDataWarningBanner(validation.reasons);
            hideNoDataState();
            appHasEverLoadedData = true;
            startApp(currentTab || "rfa");
        } else {
            // ข้อมูลสดผิดปกติ และไม่มีแคชสำรองเลย -> ไม่แสดงตาราง
            hideLoadProgressUI();
            showNoDataState();
            appHasEverLoadedData = false;
            if (splashStatus) splashStatus.textContent = "ไม่พบข้อมูล";
            updateCacheStatusUI("ไม่สามารถเชื่อมต่อฐานข้อมูลได้");
            startApp(currentTab || "rfa");
        }
    } else if (baselineRecord) {
        // ดึงสดล้มเหลวโดยสิ้นเชิง แต่มีแคชเดิมให้ใช้แทนได้ -> fallback ไปแคช พร้อมแจ้งเตือน
        DOCUMENTS_BY_TAB.rfa = baselineRecord.rfa || [];
        DOCUMENTS_BY_TAB.rfi = baselineRecord.rfi || [];
        DOCUMENTS_BY_TAB.letter = baselineRecord.letter || [];

        updateCacheStatusUI(formatTimestampTo24H(baselineRecord.timestamp));
        showDataWarningBanner(["ไม่สามารถเชื่อมต่อ Google Sheets ได้ ระบบแสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน"]);
        hideNoDataState();
        appHasEverLoadedData = true;
        startApp(currentTab || "rfa");
    } else {
        // ดึงสดล้มเหลว และไม่มีแคชสำรองเลย -> ไม่แสดงตาราง
        hideLoadProgressUI();
        showNoDataState();
        appHasEverLoadedData = false;
        if (splashStatus) splashStatus.textContent = "ไม่พบข้อมูล";
        updateCacheStatusUI("ไม่สามารถเชื่อมต่อฐานข้อมูลได้");
        startApp(currentTab || "rfa");
    }

    startBackgroundCacheCheck(); // เริ่ม/รีเซ็ตรอบตรวจสอบพื้นหลังทุก 15 นาที (จะพักเองเมื่อแท็บไม่ได้โฟกัส)
    await runCacheDiagnostic(); // อัปเดตรายงานให้ตรงกับสถานะล่าสุดเสมอ ไม่ว่าจะเข้าทางไหน
}

// ---------------------------------------------------------------------------
// Date Helpers
// ---------------------------------------------------------------------------
// แปลงวันที่รูปแบบ DD/MM/YY (ตามที่ table ใช้) เป็น Date object เพื่อเปรียบเทียบ
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

// หาวันที่ update ล่าสุด
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

// อัปเดตข้อความวันที่ล่าสุดใต้ pie chart ให้ตรงกับข้อมูลที่กำลังแสดงอยู่ในตาราง (activeDocuments)
function updateLatestDateDisplay() {
    const globalLatestEl = document.getElementById("globalLatestUpdate");
    if (globalLatestEl) {
        globalLatestEl.textContent = getLatestUpdateDate(activeDocuments);
    }
}

