/* config.js — ระบบสารบรรณอิเล็กทรอนิกส์
   สถานะแอป, ธีมกราฟ (อ่านค่าจาก CSS), ค่าตั้งต้นของแต่ละแท็บ, และฟังก์ชันช่วยเหลือทั่วไป

   ไฟล์นี้ต้องถูกโหลดเป็นไฟล์ "แรก" ก่อน data-service.js และ ui-render.js
   เพราะอีก 2 ไฟล์ใช้ตัวแปร/ฟังก์ชันจากไฟล์นี้ (เช่น TAB_CONFIGS, DOCUMENTS_BY_TAB,
   activeDocuments, buildChartTheme, formatCount, escapeHTML, toDisplayString,
   generateDropdownItems, donutCenterTextPlugin, matchesAllSearchTerms,
   parseHashState, pendingFilterStateFromURL)
   ========================================================================= */

// App Version
// อ่านจากค่าที่ index.html ดึงจาก version.json มาให้ตอน bootstrap (window.__APP_VERSION)
// เพื่อให้ "version.json" เป็นแหล่งความจริงจุดเดียว ไม่ต้องแก้เลขซ้ำในไฟล์นี้อีก
// fallback ด้านหลังไว้เผื่อกรณี asset นี้ถูกโหลดตรงๆ นอก flow bootstrap ปกติเท่านั้น
const APP_CACHE_VERSION = window.__APP_VERSION || "260914.001";
// ใช้ตรวจหาเวอร์ชันใหม่จาก server โดยไม่พึ่ง JavaScript cache ของ browser
const APP_VERSION_MANIFEST_URL = "version.json";

// ---------------------------------------------------------------------------
// URL Hash State (อ่าน/เขียนแท็บ + คำค้นหา + ตัวกรองทั้งหมดผ่าน URL hash)
// รูปแบบ: #tab?q=...&cat=A,B&type=X,Y&workType=...&source=...&cx=CODE
// ตัวอย่าง:
//   #rfi
//   #rfa?q=คอนกรีต
//   #rfa?cat=SUB,DWG&type=B-SUB&cx=C1
// ---------------------------------------------------------------------------
function parseHashState() {
    const rawHash = window.location.hash.replace('#', '');
    const qIndex = rawHash.indexOf('?');
    const tabPart = qIndex === -1 ? rawHash : rawHash.slice(0, qIndex);
    const queryPart = qIndex === -1 ? '' : rawHash.slice(qIndex + 1);

    const tab = ['rfa', 'rfi', 'letter'].includes((tabPart || '').toLowerCase())
        ? tabPart.toLowerCase()
        : 'rfa';

    const params = new URLSearchParams(queryPart);

    const parseListParam = (key) => {
        if (!params.has(key)) return null;
        const raw = params.get(key);
        return raw === '' ? [] : raw.split(',');
    };

    return {
        tab,
        query: params.has('q') ? params.get('q') : '',
        cat: parseListParam('cat'),
        type: parseListParam('type'),
        workType: parseListParam('workType'),
        source: parseListParam('source'),
        cx: params.has('cx') ? params.get('cx') : null
    };
}

// สถานะจาก URL ตอนโหลดหน้า/ตอน hash เปลี่ยน — ใช้ครั้งเดียวแล้วเคลียร์ทิ้งใน applyFilterStateToTab()
// (ดูฟังก์ชัน applyFilterStateToTab และ switchTab ใน ui-render.js)
let pendingFilterStateFromURL = parseHashState();

// ---------------------------------------------------------------------------
// App State (สถานะการทำงานของแอป)
// ---------------------------------------------------------------------------
let currentTab = pendingFilterStateFromURL.tab;
let currentPage = 1;
const ITEMS_PER_PAGE = 50;
let isSortOrderDescending = true;
let pieChartInstance = null;
let barChartInstance = null;

// ตัวแปรสำหรับเก็บสถานะการคลิกกรองบน Chart
let selectedTypeFilter = null; // สำหรับ Pie Chart (ประเภทเอกสาร)
let selectedCxFilter = null;   // สำหรับ Bar Chart (Cx Code)

// Google Spreadsheet ID
const SPREADSHEET_ID = "1QN-vHpbzTQKuZH_uieQ3brS-ZxS2k5ek6ECL38pswAc";

// ---------------------------------------------------------------------------
// Chart Theme — อ่านสี/ขนาด/สัดส่วนทั้งหมดจาก CSS Custom Properties
// เพื่อให้ Chart.js (วาดบน <canvas>) ใช้ค่าชุดเดียวกับส่วนอื่นของหน้าเว็บ
// ---------------------------------------------------------------------------
function getCssVariable(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
}

function buildChartTheme() {
    return {
        fontFamily: getCssVariable("--font-family-chart"),
        paletteColors: [
            getCssVariable("--chart-color-1"),
            getCssVariable("--chart-color-2"),
            getCssVariable("--chart-color-3"),
            getCssVariable("--chart-color-4"),
            getCssVariable("--chart-color-5"),
            getCssVariable("--chart-color-6"),
            getCssVariable("--chart-color-7"),
            getCssVariable("--chart-color-8")
        ],
        barColor: getCssVariable("--chart-bar-color"),
        gridColor: getCssVariable("--chart-grid-color"),
        dataLabelColor: getCssVariable("--chart-datalabel-color"),
        legendFontSize: parseFloat(getCssVariable("--chart-font-size-legend")) || 8,
        pieDataLabelFontSize: parseFloat(getCssVariable("--chart-font-size-datalabel-pie")) || 10,
        barDataLabelFontSize: parseFloat(getCssVariable("--chart-font-size-datalabel-bar")) || 11,
        axisTickFontSize: parseFloat(getCssVariable("--chart-font-size-axis-tick")) || 10,
        axisLabelFontSize: parseFloat(getCssVariable("--chart-font-size-axis-label")) || 12,
        donutCutoutPercent: getCssVariable("--layout-donut-cutout") || "58%",
        pieCutoutPercent: getCssVariable("--layout-pie-cutout") || "0%",
        dataLabelMinPercentToShow: parseFloat(getCssVariable("--chart-datalabel-min-percent")) || 0.05,
        pieTopCategoryCount: parseInt(getCssVariable("--chart-pie-top-n"), 10) || 7,
        barThickness: parseInt(getCssVariable("--chart-bar-thickness"), 10) || 14,

        donutCenterFontSize: parseFloat(getCssVariable("--chart-font-size-donut-center")) || 21,
        donutCenterColor: getCssVariable("--chart-donut-center-color") || "#111111",
        donutCenterFontWeight: getCssVariable("--chart-donut-center-font-weight") || "700"
    };
}

let chartTheme = null;
const donutCenterTextPlugin = {
    id: "donutCenterText",
    afterDraw(chart) {
        if (chart.config.type !== "doughnut") return;
        if (!chart.chartArea) return;
        if (!chartTheme) return;

        const { ctx, chartArea } = chart;
        const centerX = (chartArea.left + chartArea.right) / 2;
        const centerY = (chartArea.top + chartArea.bottom) / 2;
        const totalText = (typeof activeDocuments !== "undefined" ? activeDocuments.length : 0).toLocaleString();

        ctx.save();
        ctx.font = `${chartTheme.donutCenterFontWeight} ${chartTheme.donutCenterFontSize}px ${chartTheme.fontFamily}`;
        ctx.fillStyle = chartTheme.donutCenterColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(totalText, centerX, centerY);
        ctx.restore();
    }
};

// ---------------------------------------------------------------------------
// Tab Configs (ค่าตั้งต้นของแต่ละแท็บเอกสาร)
// ---------------------------------------------------------------------------
const TAB_CONFIGS = {
    rfa: {
        title: "ระบบสารบรรณอิเล็กทรอนิกส์ RFA",
        bannerClass: "banner_rfa",
        dropdowns: [
            { id: "cat", label: "หมวดงาน", items: [], renderAs: "chips" },
            { id: "type", label: "ประเภทเอกสาร", search: true, items: [] }
        ],
        searchStyle: "yellow",
        searchLabel: 'กรอกคำค้นหาจาก <strong>ชื่อเอกสาร</strong>',
        showSpecificFilter: true,
        showDocCountBox: true,
        chartType: "pie"
    },
    rfi: {
        title: "ระบบสารบรรณอิเล็กทรอนิกส์ RFI",
        bannerClass: "banner_rfi",
        dropdowns: [
            { id: "workType", label: "ประเภทงาน", search: true, items: [] }
        ],
        searchStyle: "orange",
        searchLabel: 'กรอกคำค้นหาจาก <strong>ชื่อเอกสาร</strong>',
        showSpecificFilter: false,
        showDocCountBox: true,
        chartType: "pie"
    },
    letter: {
        title: "ระบบสารบรรณอิเล็กทรอนิกส์ Letter In",
        bannerClass: "banner_letter",
        dropdowns: [
            { id: "source", label: "ที่มา", items: [], renderAs: "chips" }
        ],
        searchStyle: "lightblue",
        searchLabel: 'กรอกคำค้นหา',
        showSpecificFilter: false,
        showDocCountBox: true,
        chartType: "donut",
        donutCenterText: "0",
        hideBarChart: true
    }
};

// Initial empty state
const DOCUMENTS_BY_TAB = { rfa: [], rfi: [], letter: [] };
let activeDocuments = [];

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------
function formatCount(num) {
    const n = Number(num) || 0;
    if (n >= 1000) {
        return (n / 1000).toFixed(1) + "K";
    }
    return n.toLocaleString();
}

function escapeHTML(rawText) {
    if (!rawText) return "";
    return rawText.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// แปลงค่าใด ๆ ให้เป็นสตริงที่ตัดช่องว่างหัวท้ายแล้ว พร้อมสำหรับแสดงผล
function toDisplayString(value) {
    return value !== null && value !== undefined ? String(value).trim() : "";
}

// Generate Dropdown Items Dynamically
function generateDropdownItems(docs, filterKey) {
    const counts = {};
    docs.forEach(doc => {
        let key = "Others";
        if (filterKey === "cat") key = doc.category || "SUB";
        else if (filterKey === "type" || filterKey === "workType") key = doc.parsedCode || "Others";
        else if (filterKey === "source") key = doc.parsedCode || "CSBN1";
        counts[key] = (counts[key] || 0) + 1;
    });

    return Object.keys(counts).map(code => ({
        code: code,
        name: code,
        rawCount: counts[code],
        count: formatCount(counts[code])
    })).sort((a, b) => b.rawCount - a.rawCount);
}

// ค้นหาแบบ "AND" หลายคำ/หลายวลี
// - ข้อความปกติ คั่นด้วยช่องว่าง -> แยกเป็นคำย่อยแบบเดิม (AND ทีละคำ)
// - ข้อความที่ครอบด้วยเครื่องหมายคำพูด "..." -> ถือเป็น "วลีเดียว" ไม่ถูกแยกคำ
function matchesAllSearchTerms(doc, tabId, searchQuery) {
    if (!searchQuery) return true;
    const tokenPattern = /"([^"]+)"|(\S+)/g;
    const terms = [];
    let match;
    while ((match = tokenPattern.exec(searchQuery)) !== null) {
        const term = (match[1] !== undefined ? match[1] : match[2]).trim().toLowerCase();
        if (term.length > 0) terms.push(term);
    }
    if (terms.length === 0) return true;

    const haystackFields = tabId === "letter"
        ? [doc.receiveNo, doc.letterNo, doc.title, doc.updateDate]
        : [doc.title, doc.parsedCode];

    const combinedText = haystackFields
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return terms.every(term => combinedText.includes(term));
}

// ฟังก์ชันสำหรับ Parse ข้อมูลชีท SUB, DWG, RFI (ปรับใหม่ ไม่เก็บ Link แต่เก็บเป็น Boolean)
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

    // เช็คว่าคอลัมน์ Link (Index 3) มีค่าหรือไม่
    const linkValue = toDisplayString(rowObj.c[3]?.v);

    return {
        id,
        folderName: toDisplayString(rowObj.c[0]?.v),
        pathCode: toDisplayString(rowObj.c[1]?.v),
        parsedCode,
        cxCode,
        title,
        fileName,
        hasLink: !!linkValue && linkValue.startsWith("http"), // แจ้ง UI ว่ามี Link จริงไหม
        updateDate,
        category: docCategory
    };
}

// ฟังก์ชันสำหรับ Parse ข้อมูลชีท Letter (ปรับใหม่ ไม่เก็บ Link แต่เก็บเป็น Boolean)
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

    // เช็คว่าคอลัมน์ Link (Index 4) มีค่าหรือไม่
    const linkValue = toDisplayString(rowObj.c[4]?.v);

    return {
        id,
        parsedCode: toDisplayString(rowObj.c[0]?.v), // คอลัมน์ A (Index 0) = ที่มา
        receiveNo: toDisplayString(rowObj.c[1]?.v),  // คอลัมน์ B (Index 1) = เลขรับ
        letterNo: toDisplayString(rowObj.c[2]?.v),   // คอลัมน์ C (Index 2) = เลขหนังสือ
        title: toDisplayString(rowObj.c[3]?.v),      // คอลัมน์ D (Index 3) = ชื่อเรื่อง
        hasLink: !!linkValue && linkValue.startsWith("http"), // แจ้ง UI ว่ามี Link จริงไหม
        updateDate: updateDate,                      // คอลัมน์ F (Index 5) = วันที่ Update
        category: "Letter"
    };
}

