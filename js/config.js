/* config.js — ระบบสารบรรณอิเล็กทรอนิกส์
   สถานะแอป, ธีมกราฟ (อ่านค่าจาก CSS), ค่าตั้งต้นของแต่ละแท็บ, และฟังก์ชันช่วยเหลือทั่วไป

   ไฟล์นี้ต้องถูกโหลดเป็นไฟล์ "แรก" ก่อน data-service.js และ ui-render.js
   เพราะอีก 2 ไฟล์ใช้ตัวแปร/ฟังก์ชันจากไฟล์นี้ (เช่น TAB_CONFIGS, DOCUMENTS_BY_TAB,
   activeDocuments, buildChartTheme, formatCount, escapeHTML, toDisplayString,
   generateDropdownItems, donutCenterTextPlugin, matchesAllSearchTerms,
   parseHashState, pendingFilterStateFromURL)

   หมวดหมู่ในไฟล์นี้:
     1. App State (สถานะการทำงานของแอป)
     2. URL Hash State (อ่านแท็บ + คำค้นหา + ตัวกรองทั้งหมดจาก URL hash)
     3. Chart Theme (ธีมกราฟที่อ่านค่าจาก CSS Custom Properties)
     4. Donut Center Text Plugin (วาดตัวเลขรวมตรงกลางวงแหวนบน Canvas โดยตรง)
     5. Tab Configs (ค่าตั้งต้นของแต่ละแท็บเอกสาร)
     6. Helper Functions (ฟังก์ชันช่วยเหลือทั่วไป)
   ========================================================================= */

// App Version 
const APP_CACHE_VERSION = "260820.1600";

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

    // null = ไม่ได้ระบุ key นี้ใน URL เลย -> ไม่ยุ่งกับตัวกรองนี้ ใช้ค่า default (เลือกทั้งหมด)
    // []   = ระบุมาแต่เป็นค่าว่าง -> ผู้แชร์ตั้งใจไม่เลือกอะไรเลยในตัวกรองนี้
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
    if (num >= 1000) {
        const val = (num / 1000).toFixed(1);
        return val.endsWith(".0") ? (num / 1000) + "K" : val + "K";
    }
    return num.toLocaleString();
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

