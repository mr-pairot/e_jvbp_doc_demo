/* ui-render.js — ระบบสารบรรณอิเล็กทรอนิกส์
   การแสดงผลหน้าจอทั้งหมด: แท็บ, ดรอปดาวน์ตัวกรอง, ช่องค้นหา, ตารางเอกสาร,
   pagination และกราฟ (Pie/Donut + Bar)

   ต้องโหลดหลัง config.js (ใช้ TAB_CONFIGS, DOCUMENTS_BY_TAB, activeDocuments,
   ITEMS_PER_PAGE, formatCount, generateDropdownItems, chartTheme, buildChartTheme,
   donutCenterTextPlugin, matchesAllSearchTerms, parseHashState, pendingFilterStateFromURL)
   และหลัง data-service.js (ใช้ updateLatestDateDisplay)
   ========================================================================= */

// ---------------------------------------------------------------------------
// UI Rendering
// ---------------------------------------------------------------------------
function updateTabBadges() {
    const badgeRFA = document.querySelector(".badge_rfa");
    if (badgeRFA) badgeRFA.textContent = formatCount(DOCUMENTS_BY_TAB.rfa.length);
    const badgeRFI = document.querySelector(".badge_rfi");
    if (badgeRFI) badgeRFI.textContent = formatCount(DOCUMENTS_BY_TAB.rfi.length);
    const badgeLetter = document.querySelector(".badge_letter");
    if (badgeLetter) badgeLetter.textContent = formatCount(DOCUMENTS_BY_TAB.letter.length);
}

function switchTab(tabId) {
    currentTab = tabId;
    currentPage = 1;
    selectedTypeFilter = null;
    selectedCxFilter = null;
    const config = TAB_CONFIGS[tabId];
    activeDocuments = [...DOCUMENTS_BY_TAB[tabId]];

    document.querySelectorAll(".typeDoc_tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));

    const centerControl = document.querySelector(".center_control");
    if (centerControl) {
        centerControl.classList.remove("unfold-in");
        void centerControl.offsetWidth; // force reflow
        centerControl.classList.add("unfold-in");
    }

    updateTabBadges();
    renderSearchAndCount(config);

    if (tabId === "rfa") {
        config.dropdowns[0].items = generateDropdownItems(activeDocuments, "cat");
        config.dropdowns[1].items = generateDropdownItems(activeDocuments, "type");
    } else if (tabId === "rfi") {
        config.dropdowns[0].items = generateDropdownItems(activeDocuments, "workType");
    } else if (tabId === "letter") {
        config.dropdowns[0].items = generateDropdownItems(activeDocuments, "source");
    }

    renderDropdowns(config.dropdowns);

    if (tabId === "rfa") refreshTypeDropdownByCategory();

    renderTableHeader(tabId);
    renderCharts(config);

    // ถ้ามีสถานะตัวกรองจาก URL (ตอนโหลดหน้าแรก หรือ hashchange) ที่ตรงกับแท็บนี้
    // ให้นำมาตั้งค่าตัวกรอง/ช่องค้นหาทั้งหมด แล้ว filter ทันที
    // ถ้าไม่มี ให้ filter ตามค่า default (เลือกทั้งหมด) ตามปกติ
    if (pendingFilterStateFromURL && pendingFilterStateFromURL.tab === tabId) {
        applyFilterStateToTab(pendingFilterStateFromURL);
        pendingFilterStateFromURL = null;
    } else {
        filterActiveTabDocuments();
    }
}


function renderDropdowns(dropdownConfigs) {
    const container = document.getElementById("dropdownsContainer");
    if (!container) return;
    container.innerHTML = "";

    dropdownConfigs.forEach(dropdownConfig => {
        if (dropdownConfig.renderAs === "chips") {
            renderChipFilterGroup(dropdownConfig, container);
        } else {
            renderClassicDropdown(dropdownConfig, container);
        }
    });

    document.addEventListener("click", () => document.querySelectorAll(".dropdown_popup").forEach(popupEl => popupEl.classList.remove("active")));
}

// ตัวกรองแบบ Dropdown ดั้งเดิม (มี popup + checkbox list + ปุ่ม "เท่านั้น")
// ใช้กับตัวเลือกที่มีจำนวนมาก เช่น "ประเภทเอกสาร" ของ RFA และ "ประเภทงาน" ของ RFI
function renderClassicDropdown(dropdownConfig, container) {
    const dropdownEl = document.createElement("div");
    dropdownEl.className = "custom_dropdown_container";
    dropdownEl.dataset.dropdownId = dropdownConfig.id;

    dropdownEl.innerHTML = `
        <div class="dropdown_trigger" id="trig_${dropdownConfig.id}">
            <span class="dropdown_title">${dropdownConfig.label}</span>
            <span class="dropdown_arrow">▼</span>
        </div>
        <div class="dropdown_popup" id="pop_${dropdownConfig.id}">
            <div class="popup_header">
                <label class="checkbox_label"><input type="checkbox" id="chkAll_${dropdownConfig.id}" checked><span><strong>${dropdownConfig.label}</strong></span></label>
            </div>
            ${dropdownConfig.search ? `
            <div class="popup_search_box">
                <span class="search_icon">🔍</span>
                <input type="text" id="srch_${dropdownConfig.id}" placeholder="พิมพ์เพื่อค้นหา">
            </div>` : ''}
            <div class="popup_list" id="list_${dropdownConfig.id}">
                ${buildPopupItemsHTML(dropdownConfig)}
            </div>
        </div>`;
    container.appendChild(dropdownEl);

    bindDropdownEvents(dropdownConfig, dropdownEl);
}

function buildPopupItemsHTML(dropdownConfig) {
    return dropdownConfig.items.map(item => `
        <label class="checkbox_label popup_item row_${dropdownConfig.id}">
            <div class="popup_item_checkbox_group">
                <input type="checkbox" class="chk_item_${dropdownConfig.id}" value="${item.code}" checked><span>${item.name}</span>
            </div>
            <div class="popup_item_actions">
                <button type="button" class="btn_only_item" data-value="${item.code}">เท่านั้น</button>
                <span class="item_count">${item.count}</span>
            </div>
        </label>
    `).join('');
}

function updateDropdownTitle(dropdownConfig, dropdownEl) {
    const checkboxes = Array.from(dropdownEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`));
    const checkedBoxes = checkboxes.filter(chk => chk.checked);
    const titleSpan = dropdownEl.querySelector('.dropdown_title');
    const trigger = dropdownEl.querySelector('.dropdown_trigger');

    let displayText = dropdownConfig.label;

    if (checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length) {
        const names = checkedBoxes.map(chk => chk.nextElementSibling.textContent).join(', ');
        displayText = `${dropdownConfig.label} : ${names}`;
    } else if (checkboxes.length > 0 && checkedBoxes.length === checkboxes.length) {
        displayText = `${dropdownConfig.label} (ทั้งหมด)`;
    } else {
        displayText = `${dropdownConfig.label} (ไม่ได้เลือก)`;
    }

    titleSpan.textContent = displayText;
    trigger.title = displayText;
}

// หาว่า Dropdown อันไหนคือ "ประเภทเอกสาร" ของแท็บที่กำลังเปิด
function getActivePieChartDropdownId() {
    if (currentTab === "rfa") return "type";
    if (currentTab === "rfi") return "workType";
    if (currentTab === "letter") return "source";
    return null;
}

// อัปเดตตัวแปร selectedTypeFilter เมื่อผู้ใช้ติ๊ก Checkbox ด้วยตัวเอง
function updateSelectedTypeFilterFromDOM(dropdownConfigId, dropdownEl) {
    const targetDropdownId = getActivePieChartDropdownId();
    if (dropdownConfigId === targetDropdownId) {
        const checkedBoxes = Array.from(dropdownEl.querySelectorAll(`.chk_item_${dropdownConfigId}:checked`));
        if (checkedBoxes.length === 1) {
            selectedTypeFilter = checkedBoxes[0].value;
        } else {
            selectedTypeFilter = null; // ถ้ายกเลิกหมด หรือเลือกมากกว่า 1 ให้กราฟกลับมาเต็มสี
        }
    }
}

function bindItemCheckboxEvents(dropdownConfig, dropdownEl) {
    dropdownEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`).forEach(checkboxInput => {
        checkboxInput.addEventListener("change", () => {
            const allCheckboxes = Array.from(dropdownEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`));
            const allChecked = allCheckboxes.length > 0 && allCheckboxes.every(c => c.checked);
            const chkAllEl = dropdownEl.querySelector(`#chkAll_${dropdownConfig.id}`);
            if (chkAllEl) chkAllEl.checked = allChecked;

            updateDropdownTitle(dropdownConfig, dropdownEl);
            updateSelectedTypeFilterFromDOM(dropdownConfig.id, dropdownEl);
            filterActiveTabDocuments();
            if (dropdownConfig.id === "cat") refreshTypeDropdownByCategory();
        });
    });

    dropdownEl.querySelectorAll(`.btn_only_item`).forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const targetValue = btn.dataset.value;
            const allCheckboxes = Array.from(dropdownEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`));

            allCheckboxes.forEach(chk => {
                chk.checked = (chk.value === targetValue);
            });

            const chkAllEl = dropdownEl.querySelector(`#chkAll_${dropdownConfig.id}`);
            if (chkAllEl) chkAllEl.checked = false;

            updateDropdownTitle(dropdownConfig, dropdownEl);
            updateSelectedTypeFilterFromDOM(dropdownConfig.id, dropdownEl);
            filterActiveTabDocuments();
            if (dropdownConfig.id === "cat") refreshTypeDropdownByCategory();
        });
    });
}

function bindDropdownEvents(dropdownConfig, dropdownEl) {
    updateDropdownTitle(dropdownConfig, dropdownEl);

    const triggerEl = dropdownEl.querySelector(`#trig_${dropdownConfig.id}`);
    const popupEl = dropdownEl.querySelector(`#pop_${dropdownConfig.id}`);
    triggerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".dropdown_popup").forEach(otherPopupEl => {
            if (otherPopupEl !== popupEl) otherPopupEl.classList.remove("active");
        });
        popupEl.classList.toggle("active");
    });

    popupEl.addEventListener("click", (e) => e.stopPropagation());

    let closeTimer = null;
    dropdownEl.addEventListener("mouseleave", () => {
        closeTimer = setTimeout(() => popupEl.classList.remove("active"), 3000);
    });
    dropdownEl.addEventListener("mouseenter", () => {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    });

    if (dropdownConfig.search) {
        const searchInput = dropdownEl.querySelector(`#srch_${dropdownConfig.id}`);
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const query = e.target.value.toLowerCase().trim();
                dropdownEl.querySelectorAll(`.row_${dropdownConfig.id}`).forEach(rowEl => {
                    const text = rowEl.querySelector("span").textContent.toLowerCase();
                    rowEl.classList.toggle("is-hidden", !text.includes(query));
                });
            });
        }
    }

    dropdownEl.querySelector(`#chkAll_${dropdownConfig.id}`).addEventListener("change", (e) => {
        dropdownEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`).forEach(checkboxInput => checkboxInput.checked = e.target.checked);
        updateDropdownTitle(dropdownConfig, dropdownEl);
        updateSelectedTypeFilterFromDOM(dropdownConfig.id, dropdownEl);
        filterActiveTabDocuments();
        if (dropdownConfig.id === "cat") refreshTypeDropdownByCategory();
    });

    bindItemCheckboxEvents(dropdownConfig, dropdownEl);
}

// ---------------------------------------------------------------------------
// 1.1 Chip Filter Group (ตัวกรองแบบการ์ด/chip)
// ใช้แทน Dropdown เดิมสำหรับตัวเลือกที่มีจำนวนน้อย (2-3 รายการ) เช่น
// "หมวดงาน" ของ RFA และ "ที่มา" ของ Letter In
// ---------------------------------------------------------------------------
function buildChipItemsHTML(dropdownConfig) {
    return dropdownConfig.items.map(item => `
        <label class="chip_filter_item">
            <input type="checkbox" class="chk_item_${dropdownConfig.id}" value="${item.code}" checked>
            <span class="chip_filter_name">${item.name}</span>
            <span class="chip_filter_badge">${item.count}</span>
        </label>
    `).join('');
}

// ไล่ toggle class .is-selected ให้ตรงกับสถานะ checkbox จริงของแต่ละ chip
function syncChipVisualState(groupEl, dropdownId) {
    groupEl.querySelectorAll(".chip_filter_item").forEach(labelEl => {
        const chk = labelEl.querySelector(`.chk_item_${dropdownId}`);
        labelEl.classList.toggle("is-selected", chk.checked);
    });
}

// อัปเดตข้อความหัวกลุ่ม เช่น "หมวดงาน" หรือ "หมวดงาน (2/3)" เมื่อเลือกไม่ครบทุกตัว
function updateChipHeaderLabel(dropdownConfig, groupEl) {
    const boxes = Array.from(groupEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`));
    const checkedBoxes = boxes.filter(c => c.checked);
    const labelEl = groupEl.querySelector(".chip_filter_label");
    if (!labelEl) return;

    labelEl.textContent = (checkedBoxes.length === boxes.length || checkedBoxes.length === 0)
        ? dropdownConfig.label
        : `${dropdownConfig.label} (${checkedBoxes.length}/${boxes.length})`;
}

function renderChipFilterGroup(dropdownConfig, container) {
    const groupEl = document.createElement("div");
    groupEl.className = "chip_filter_group";
    groupEl.dataset.dropdownId = dropdownConfig.id;

    groupEl.innerHTML = `
        <div class="chip_filter_header" id="chipHeader_${dropdownConfig.id}" title="แตะเพื่อเลือกทั้งหมด/ไม่เลือกเลย">
            <span class="chip_filter_label">${dropdownConfig.label}</span>
        </div>
        <div class="chip_filter_list">
            ${buildChipItemsHTML(dropdownConfig)}
        </div>`;

    container.appendChild(groupEl);
    bindChipGroupEvents(dropdownConfig, groupEl);
}

function bindChipGroupEvents(dropdownConfig, groupEl) {
    const getBoxes = () => Array.from(groupEl.querySelectorAll(`.chk_item_${dropdownConfig.id}`));

    function afterChipChange() {
        syncChipVisualState(groupEl, dropdownConfig.id);
        updateChipHeaderLabel(dropdownConfig, groupEl);
        updateSelectedTypeFilterFromDOM(dropdownConfig.id, groupEl);
        filterActiveTabDocuments();
        if (dropdownConfig.id === "cat") refreshTypeDropdownByCategory();
    }

    getBoxes().forEach(checkboxInput => {
        checkboxInput.addEventListener("change", afterChipChange);
    });

    // แตะที่หัวกลุ่ม (label ของหมวด) = สลับสถานะ "เลือกทั้งหมด" <-> "ไม่เลือกเลย"
    const headerEl = groupEl.querySelector(`#chipHeader_${dropdownConfig.id}`);
    if (headerEl) {
        headerEl.addEventListener("click", () => {
            const boxes = getBoxes();
            const allChecked = boxes.length > 0 && boxes.every(c => c.checked);
            boxes.forEach(c => { c.checked = !allChecked; });
            afterChipChange();
        });
    }

    syncChipVisualState(groupEl, dropdownConfig.id);
    updateChipHeaderLabel(dropdownConfig, groupEl);
}

function refreshTypeDropdownByCategory() {
    if (currentTab !== "rfa") return;

    const typeDropdownEl = document.querySelector('.custom_dropdown_container[data-dropdown-id="type"]');
    if (!typeDropdownEl) return;

    const checkedCats = Array.from(document.querySelectorAll(".chk_item_cat:checked")).map(chk => chk.value.toUpperCase());
    const allTypeItems = generateDropdownItems(DOCUMENTS_BY_TAB.rfa, "type");

    const filteredItems = checkedCats.length === 0
        ? []
        : allTypeItems.filter(item => {
            const suffix = item.code.length >= 3 ? item.code.slice(-3).toUpperCase() : "";
            if (suffix === "SUB" || suffix === "DWG") return checkedCats.includes(suffix);
            else return checkedCats.includes("อื่นๆ");
        });

    const typeConfig = TAB_CONFIGS.rfa.dropdowns[1];
    typeConfig.items = filteredItems;

    const listContainer = typeDropdownEl.querySelector(`#list_${typeConfig.id}`);
    if (listContainer) listContainer.innerHTML = buildPopupItemsHTML(typeConfig);

    const chkAllType = typeDropdownEl.querySelector(`#chkAll_${typeConfig.id}`);
    if (chkAllType) chkAllType.checked = true;

    // Reset Pie Chart Highlight State เพราะตัวเลือกเปลี่ยน
    selectedTypeFilter = null;

    bindItemCheckboxEvents(typeConfig, typeDropdownEl);
    updateDropdownTitle(typeConfig, typeDropdownEl);
    filterActiveTabDocuments();
}


function renderSearchAndCount(config) {
    const row = document.getElementById("searchCountRow");
    if (!row) return;

    const docCountClass = `doc_count_area${currentTab === "letter" ? " doc_count_area--mobile-only" : ""}`;

    row.innerHTML = `
        <div class="search_box_area">
            <div class="${config.searchStyle}_search_box">
                <label class="search_label">
                    <span>${config.searchLabel}</span>
                    <button type="button" class="copy_search_link_btn" id="btnCopySearchLink" title="คัดลอกลิงก์พร้อมคำค้นหา/ตัวกรองปัจจุบัน">
                        <img src="img/share_link.png" alt="" class="copy_search_link_icon">
                        <span class="copy_search_link_text">คัดลอก Link ค้นหา</span>
                    </button>
                </label>
                <div class="search_input_wrapper">
                    <input type="text" class="main_search_input" id="mainSearchInput" placeholder="พิมพ์คำค้นหา [กรณีหาหลายคำให้เว้นวรรค, ค้นหากลุ่มคำให้ครอบด้วยคำพูด เช่น คอนกรีต สะพาน &quot;14 วัน&quot;]">
                    <button type="button" class="clear_search_btn" id="btnClearSearch" title="ล้างข้อความค้นหา">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <line x1="1" y1="1" x2="9" y2="9"></line>
                            <line x1="9" y1="1" x2="1" y2="9"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="filter_status_box" id="filterStatusBox">
                <div class="filter_status_inner" id="filterStatusInner"></div>
            </div>
        </div>
        ${config.showDocCountBox ? `<div class="${docCountClass}"><div class="count_title">จำนวนเอกสาร</div><div class="count_value" id="totalDocNumber">${activeDocuments.length.toLocaleString()}</div></div>` : '<div></div>'}
    `;
    document.getElementById("mainSearchInput").addEventListener("input", filterActiveTabDocuments);
    document.getElementById("btnClearSearch").addEventListener("click", () => {
        const input = document.getElementById("mainSearchInput");
        if(input) {
            input.value = "";
            filterActiveTabDocuments();
        }
    });
    initCopySearchLinkButton();
    updateFilterStatusBox();
}

// ผูก event ปุ่ม "คัดลอก Link ค้นหา" — คัดลอก URL ปัจจุบัน (มี hash ของแท็บ/คำค้นหา/
// ตัวกรองที่ sync ไว้แล้วโดย syncURLHash()) พร้อมข้อความสรุปตัวกรองที่ใช้อยู่
// เข้าคลิปบอร์ด พร้อมแสดงสถานะสำเร็จ/ล้มเหลวชั่วคราวบนปุ่ม
function initCopySearchLinkButton() {
    const btn = document.getElementById("btnCopySearchLink");
    if (!btn) return;

    btn.addEventListener("pointerenter", (e) => {
       if (e.pointerType === "pen") btn.classList.add("is-pen-hover");
    });
    btn.addEventListener("pointerleave", (e) => {
       if (e.pointerType === "pen") btn.classList.remove("is-pen-hover");
    });

    const textSpan = btn.querySelector(".copy_search_link_text");
    const defaultLabel = textSpan ? textSpan.textContent : "คัดลอก Link ค้นหา";
    let resetTimer = null;

    function flashLabel(label, isError) {
        if (!textSpan) return;
        if (resetTimer) clearTimeout(resetTimer);

        textSpan.textContent = label;
        btn.classList.toggle("is-copy-error", !!isError);
        btn.classList.toggle("is-copy-success", !isError);

        resetTimer = setTimeout(() => {
            textSpan.textContent = defaultLabel;
            btn.classList.remove("is-copy-error", "is-copy-success");
        }, 2000);
    }

    // สร้างข้อความสรุปตัวกรองสำหรับ Clipboard โดยตรงจากสถานะปัจจุบัน
    function buildFilterSummaryBlock_() {
        const parts = [];

        if (selectedCxFilter) {
            parts.push(`เอกสารแสดงเฉพาะรายการ Code: \n${selectedCxFilter}`);
        }

        if (currentTab === "rfa") {
            const cat = getDropdownStatusText("cat");
            const type = getDropdownStatusText("type");
            if (cat.active) parts.push(`หมวดงาน: \n${cat.text}`);
            if (type.active) parts.push(`ประเภทรายการ: \n${type.text}`);
        } else if (currentTab === "rfi") {
            const workType = getDropdownStatusText("workType");
            if (workType.active) parts.push(`หมวดงาน: \n${workType.text}`);
        } else if (currentTab === "letter") {
            const source = getDropdownStatusText("source");
            if (source.active) parts.push(`แหล่งที่มา: \n${source.text}`);
        }

        const searchInput = document.getElementById("mainSearchInput");
        const searchQuery = searchInput ? searchInput.value.trim() : "";
        if (searchQuery) parts.push(`แสดงเฉพาะคำค้นหา: \n${searchQuery}`);

        if (parts.length === 0) return "";

        return "จากการกรอง" + parts.join("\n");
    }

    async function copyCurrentURL() {
        // เขียน URL ปัจจุบันให้ตรงที่สุดก่อนคัดลอก (syncURLHash() ล้าง query string
        // ตกค้าง เช่นจาก LIFF ออกไปด้วยในตัว) แล้วประกอบข้อความสรุปตัวกรอง + URL
        if (typeof syncURLHash === "function") syncURLHash();

        const urlToCopy = window.location.href;
        const filterBlock = buildFilterSummaryBlock_();

        const textToCopy = filterBlock
            ? `Link เอกสารงานสารบรรณ\n${filterBlock}\n\n${urlToCopy}`
            : `Link เอกสารงานสารบรรณ\n${urlToCopy}`;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(textToCopy);
            } else {
                const tempInput = document.createElement("textarea");
                tempInput.value = textToCopy;
                tempInput.style.position = "fixed";
                tempInput.style.opacity = "0";
                document.body.appendChild(tempInput);
                tempInput.focus();
                tempInput.select();
                document.execCommand("copy");
                document.body.removeChild(tempInput);
            }
            flashLabel("คัดลอกลิงก์แล้ว ✓", false);
        } catch (err) {
            console.warn("คัดลอกลิงก์ไม่สำเร็จ:", err);
            flashLabel("คัดลอกไม่สำเร็จ ✕", true);
        }
    }

    btn.addEventListener("click", copyCurrentURL);
}

function renderTableHeader(tabId) {
    const headContainer = document.getElementById("tableHeadContainer");
    if (!headContainer) return;
    const arrow = isSortOrderDescending ? "▼" : "▲";

    if (tabId === "letter") {
        headContainer.innerHTML = `
            <tr>
                <th class="col_receive">เลขรับ</th>
                <th class="col_letterno">เลขหนังสือ</th>
                <th class="col_title">ชื่อเรื่อง</th>
                <th class="col_update sortable" onclick="toggleSort()">Update <span class="arrow_sort">${arrow}</span></th>
            </tr>
        `;
    } else {
        headContainer.innerHTML = `
            <tr>
                <th class="col_title">ชื่อเอกสาร</th>
                <th class="col_update sortable" onclick="toggleSort()"> Update <span class="arrow_sort">${arrow}</span></th>
            </tr>
        `;
    }
}

function toggleSort() {
    isSortOrderDescending = !isSortOrderDescending;
    const arrowSpan = document.querySelector(".arrow_sort");
    if (arrowSpan) {
        arrowSpan.textContent = isSortOrderDescending ? "▼" : "▲";
    }
    renderTableBody();
}

// สร้าง URL ที่ใช้เปิดจริงจาก documentUrl ซึ่งเป็นฟิลด์ที่ data-service.js เก็บไว้
// - แปลงลิงก์ Google Drive แบบ "/view" ให้เป็น "/preview" (เพื่อเปิดแบบฝัง/ดูตรงๆ ได้)
// - คืนค่า null ถ้าไม่มีลิงก์ที่ใช้งานได้จริง แทนที่จะปล่อยให้เป็น "#" ซึ่งกดแล้วไม่เปิดอะไรเลย
function resolveDocumentUrl_(doc) {
    // documentUrl เป็นฟิลด์มาตรฐานของข้อมูลทุกแท็บ (RFA, RFI และ Letter)
    // ส่วนฟิลด์เก่าคงไว้เฉพาะเพื่อรองรับข้อมูลที่ถูกสร้างจากเวอร์ชันก่อนหน้า
    const raw = (doc.documentUrl || doc.link || doc.url || doc.fileUrl || "").toString().trim();

    // ต้องเป็น http(s) URL จริงเท่านั้น กันค่าขยะ เช่น "-", "#", ช่องว่าง
    if (!raw || !/^https?:\/\//i.test(raw)) return null;

    let url = raw;
    if (url.includes('drive.google.com/file/d/') && url.includes('/view')) {
        url = url.replace('/view', '/preview');
    }
    return url;
}

function renderTableBody() {
    const tbody = document.getElementById("documentTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const sortedDocs = [...activeDocuments].sort((a, b) => {
        const dateA = parseUpdateDateToDate(a.updateDate);
        const dateB = parseUpdateDateToDate(b.updateDate);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return isSortOrderDescending ? (dateB - dateA) : (dateA - dateB);
    });
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const pageDocs = sortedDocs.slice(startIdx, endIdx);

    if (pageDocs.length === 0) {
        const colspan = currentTab === "letter" ? 4 : 2;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="table_empty_state">ไม่พบรายการเอกสาร</td></tr>`;
    } else {
        pageDocs.forEach((doc, idx) => {
            const rowEl = document.createElement("tr");
            const safeTitle = escapeHTML(doc.title);

            // ดึงลิงก์เอกสารจริง (คืนค่า null ถ้าไม่มีลิงก์ที่เปิดได้)
            const docUrl = resolveDocumentUrl_(doc);

            // ใช้ URL และชื่อเรื่องชุดเดียวกันกับทุกคอลัมน์ที่เปิดเอกสารได้
            // (Letter In: เลขรับ, เลขหนังสือ และชื่อเรื่อง)
            const createDocumentLinkHTML = (safeText) => {
                if (docUrl) {
                    const safeDocUrl = escapeHTML(docUrl);
                    return `<a href="${safeDocUrl}" target="_blank" rel="noopener" class="doc_hyperlink_title btn-as-link" data-title="${safeTitle}" data-category="${doc.category}" onclick="checkAuthInBackground(this)" title="คลิกเพื่อเปิด ${safeTitle}">${safeText}</a>`;
                }
                return `<span class="doc_hyperlink_title doc_hyperlink_title--disabled" title="${safeText}">${safeText}</span>`;
            };

            const linkHTML = createDocumentLinkHTML(safeTitle);

            if (currentTab === "letter") {
                const safeReceiveNo = escapeHTML(doc.receiveNo || "-");
                const safeLetterNo = escapeHTML(doc.letterNo || "-");
                const receiveNoLinkHTML = createDocumentLinkHTML(safeReceiveNo);
                const letterNoLinkHTML = createDocumentLinkHTML(safeLetterNo);

                rowEl.innerHTML = `
                    <td>
                        <div class="doc_row_container">
                            <span class="doc_number_index">${startIdx + idx + 1}.</span>
                            ${receiveNoLinkHTML}
                        </div>
                    </td>
                    <td>${letterNoLinkHTML}</td>
                    <td>${linkHTML}</td>
                    <td class="col_update"><span class="doc_update_date">${doc.updateDate}</span></td>
                `;
            } else {
                rowEl.innerHTML = `
                    <td>
                        <div class="doc_row_container">
                            <span class="doc_number_index">${startIdx + idx + 1}.</span>
                            ${linkHTML}
                        </div>
                    </td>
                    <td class="col_update"><span class="doc_update_date">${doc.updateDate}</span></td>
                `;
            }
            tbody.appendChild(rowEl);
        });
    }
    updatePagination(sortedDocs.length, startIdx, endIdx);
}

function updatePagination(totalItems, startIdx, endIdx) {
    const maxPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    const pageInfo = document.getElementById("pageInfoText");
    if (pageInfo) pageInfo.textContent = `แสดง ${totalItems === 0 ? 0 : startIdx + 1} ถึง ${Math.min(endIdx, totalItems)} จาก ${totalItems.toLocaleString()} รายการ (หน้า ${currentPage} / ${maxPages})`;

    const btnPrev = document.getElementById("btnPrev");
    const btnNext = document.getElementById("btnNext");
    if (btnPrev) btnPrev.disabled = (currentPage === 1);
    if (btnNext) btnNext.disabled = (currentPage >= maxPages);

    const pageContainer = document.getElementById("pageNumbers");
    if (pageContainer) {
        pageContainer.innerHTML = "";
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(maxPages, startPage + 4);
        if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

        for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
            const pageBtn = document.createElement("button");
            pageBtn.className = `page_btn ${pageNumber === currentPage ? 'active' : ''}`;
            pageBtn.textContent = pageNumber;
            pageBtn.onclick = () => {
                currentPage = pageNumber;
                renderTableBody();
                const tableEl = document.querySelector(".table_card");
                if (tableEl) window.scrollTo({ top: tableEl.offsetTop - 80, behavior: "smooth" });
            };
            pageContainer.appendChild(pageBtn);
        }
    }
}

function initPaginationButtons() {
    const btnPrev = document.getElementById("btnPrev");
    const btnNext = document.getElementById("btnNext");
    if (btnPrev) btnPrev.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderTableBody(); } });
    if (btnNext) btnNext.addEventListener("click", () => { if (currentPage < Math.ceil(activeDocuments.length / ITEMS_PER_PAGE)) { currentPage++; renderTableBody(); } });
}

function filterActiveTabDocuments() {
    const searchInput = document.getElementById("mainSearchInput");
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const checkedCats = Array.from(document.querySelectorAll(".chk_item_cat:checked")).map(c => c.value);
    const hasCatFilter = document.querySelectorAll(".chk_item_cat").length > 0;

    const checkedTypes = Array.from(document.querySelectorAll(".chk_item_type:checked")).map(c => c.value);
    const hasTypeFilter = document.querySelectorAll(".chk_item_type").length > 0;

    const checkedWorkTypes = Array.from(document.querySelectorAll(".chk_item_workType:checked")).map(c => c.value);
    const hasWorkTypeFilter = document.querySelectorAll(".chk_item_workType").length > 0;

    const checkedSource = Array.from(document.querySelectorAll(".chk_item_source:checked")).map(c => c.value);
    const hasSourceFilter = document.querySelectorAll(".chk_item_source").length > 0;

    activeDocuments = DOCUMENTS_BY_TAB[currentTab].filter(doc => {
        // ค้นหาแบบ AND หลายคำ (คั่นด้วยช่องว่าง) ผ่าน matchesAllSearchTerms() ใน config.js
        let matchSearch = matchesAllSearchTerms(doc, currentTab, searchQuery);

        let matchCat = !hasCatFilter || checkedCats.includes(doc.category);
        let matchType = !hasTypeFilter || checkedTypes.includes(doc.parsedCode);
        let matchWorkType = !hasWorkTypeFilter || checkedWorkTypes.includes(doc.parsedCode);
        let matchSource = !hasSourceFilter || checkedSource.includes(doc.parsedCode);

        // กรองด้วยคลิกจาก Bar Chart (Cx Code)
        let matchCx = !selectedCxFilter || doc.cxCode === selectedCxFilter;

        return matchSearch && matchCat && matchType && matchWorkType && matchSource && matchCx;
    });

    const totalEl = document.getElementById("totalDocNumber");
    if (totalEl) totalEl.textContent = activeDocuments.length.toLocaleString();

    currentPage = 1;
    renderTableBody();
    updateChartsDynamic();
    updateFilterStatusBox();
    syncURLHash();
}

// ---------------------------------------------------------------------------
// Filter Status Box (กล่องสรุปสถานะการกรอง ใต้ search box)
// ---------------------------------------------------------------------------

// อ่านสถานะ checkbox จริงของ dropdown ตาม id ที่ระบุ
// คืนค่า { active: boolean, text: string }
// active = true เมื่อมีการติ๊กเลือกบางส่วน (ไม่ใช่ทั้งหมด และไม่ใช่ 0)
function getDropdownStatusText(dropdownId) {
    const checkboxes = Array.from(document.querySelectorAll(`.chk_item_${dropdownId}`));
    if (checkboxes.length === 0) return { active: false, text: "ทั้งหมด" };
    const checked = checkboxes.filter(c => c.checked);
    if (checked.length === 0 || checked.length === checkboxes.length) {
        return { active: false, text: "ทั้งหมด" };
    }
    const names = checked.map(c => c.nextElementSibling.textContent.trim()).join(', ');
    return { active: true, text: names };
}

function updateFilterStatusBox() {
    const box = document.getElementById("filterStatusBox");
    const inner = document.getElementById("filterStatusInner");
    if (!box || !inner) return;

    const searchInput = document.getElementById("mainSearchInput");
    const searchQuery = searchInput ? searchInput.value.trim() : "";

    const lines = [];
    let hasAnyFilter = false;

    if (selectedCxFilter) {
        hasAnyFilter = true;
        lines.push(`เอกสารแสดงเฉพาะรายการ : Code ${selectedCxFilter}`);
    }

    if (currentTab === "rfa") {
        const cat = getDropdownStatusText("cat");
        const type = getDropdownStatusText("type");
        if (cat.active) { hasAnyFilter = true; lines.push(`หมวดงาน: ${cat.text}`); }
        if (type.active) { hasAnyFilter = true; lines.push(`ประเภทรายการ: ${type.text}`); }
    } else if (currentTab === "rfi") {
        const workType = getDropdownStatusText("workType");
        if (workType.active) { hasAnyFilter = true; lines.push(`หมวดงาน: ${workType.text}`); }
    } else if (currentTab === "letter") {
        const source = getDropdownStatusText("source");
        if (source.active) { hasAnyFilter = true; lines.push(`แหล่งที่มา: ${source.text}`); }
    }

    if (searchQuery) {
        hasAnyFilter = true;
        lines.push(`แสดงเฉพาะคำค้นหา: ${searchQuery}`);
    }

    box.classList.toggle("has-filter", hasAnyFilter);
    inner.innerHTML = hasAnyFilter
        ? lines.map(line => `<div class="filter_status_line" title="${escapeHTML(line)}">${escapeHTML(line)}</div>`).join('')
        : "";

    const btnClear = document.getElementById("btnClearSearch");
    if (btnClear) btnClear.classList.toggle("is-visible", hasAnyFilter);
}

// ---------------------------------------------------------------------------
// Chart Rendering & Syncing
// ---------------------------------------------------------------------------

let pieColorCacheMap = {};
let pieColorCacheIndex = 0;

// แก้ไขฟังก์ชันรับพารามิเตอร์ isPieChart เพื่อแยกการจัดการ
function getHighlightColors(baseColors, labels, selectedLabel, isPieChart = false) {
    return labels.map((label, i) => {
        let color;

        // บังคับใช้ Cache เฉพาะ Pie Chart เพื่อป้องกันสีสลับกัน
        if (isPieChart && Array.isArray(baseColors)) {
            if (label === "ไม่มีข้อมูล") return '#e0e0e0'; // ถ้าว่างให้ใช้สีเทา ไม่แคชลงระบบ

            if (!pieColorCacheMap[label]) {
                pieColorCacheMap[label] = baseColors[pieColorCacheIndex % baseColors.length];
                pieColorCacheIndex++;
            }
            color = pieColorCacheMap[label];
        } else {
            // ถ้าเป็น Bar Chart หรือข้อมูลอื่น ให้ดึงสีตามปกติ (ไม่มี Cache)
            color = Array.isArray(baseColors) ? baseColors[i % baseColors.length] : baseColors;
        }

        // ไม่มี filter (selectedLabel = null) หรือ label ตรงกับที่เลือก -> คืนสีเต็ม
        if (!selectedLabel || label === selectedLabel) return color;

        // ไม่ถูกเลือก -> เติมค่า alpha ('40' = ความโปร่งใส ~25%) ต่อท้าย Hex code
        if (typeof color === 'string' && color.startsWith('#') && (color.length === 7 || color.length === 9)) {
            return color.substring(0, 7) + '40';
        }
        return color; // Fallback
    });
}

// จัดการเมื่อคลิก Pie Chart (ชิ้น หรือ Legend)
function handlePieChartClick(clickedLabel) {
    selectedTypeFilter = (selectedTypeFilter === clickedLabel) ? null : clickedLabel;

    // Sync กลับไปที่ตัวกรอง "ประเภทเอกสาร/ที่มา" ไม่ว่าจะ render เป็น dropdown เดิม
    // หรือ chip_filter_group ใหม่ (ทั้งสองแบบมี data-dropdown-id ตรงกับ targetDropdownId เสมอ)
    const targetDropdownId = getActivePieChartDropdownId();
    if (!targetDropdownId) return;

    const containerEl = document.querySelector(`[data-dropdown-id="${targetDropdownId}"]`);
    if (containerEl) {
        const allCheckboxes = Array.from(containerEl.querySelectorAll(`.chk_item_${targetDropdownId}`));

        if (selectedTypeFilter === null) {
            allCheckboxes.forEach(chk => chk.checked = true);
        } else {
            allCheckboxes.forEach(chk => {
                chk.checked = (chk.value === selectedTypeFilter);
            });
        }

        const typeConfig = TAB_CONFIGS[currentTab].dropdowns.find(d => d.id === targetDropdownId);

        if (containerEl.classList.contains("chip_filter_group")) {
            // กล่องแบบ chip: อัปเดตสถานะสี is-selected + label หัวกลุ่ม
            syncChipVisualState(containerEl, targetDropdownId);
            if (typeConfig) updateChipHeaderLabel(typeConfig, containerEl);
        } else {
            // Dropdown แบบเดิม: อัปเดต checkbox "เลือกทั้งหมด" + title บน trigger
            const chkAllEl = containerEl.querySelector(`#chkAll_${targetDropdownId}`);
            if (chkAllEl) chkAllEl.checked = (selectedTypeFilter === null);
            if (typeConfig) updateDropdownTitle(typeConfig, containerEl);
        }
    }

    filterActiveTabDocuments();
}

function renderCharts(config) {
    if (typeof Chart === "undefined") return;
    if (!chartTheme) chartTheme = buildChartTheme();
    Chart.defaults.font.family = chartTheme.fontFamily;

    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }

    const pieCanvas = document.getElementById("typePieChart");
    if (pieCanvas) {
        const pluginList = [typeof ChartDataLabels !== "undefined" ? ChartDataLabels : {}];
        if (config.chartType === "donut") pluginList.push(donutCenterTextPlugin);

        pieChartInstance = new Chart(pieCanvas.getContext("2d"), {
            type: config.chartType === "donut" ? "doughnut" : "pie",
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: chartTheme.paletteColors
                }]
            },
            plugins: pluginList,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: config.chartType === "donut" ? chartTheme.donutCutoutPercent : chartTheme.pieCutoutPercent,
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const clickedIndex = elements[0].index;
                        const clickedLabel = pieChartInstance.data.labels[clickedIndex];
                        handlePieChartClick(clickedLabel);
                    } else {
                        handlePieChartClick(null); // คลิกว่าง = ล้างตัวกรอง
                    }
                },
                plugins: {
                    legend: {
                        position: "right",
                        labels: { usePointStyle: true, boxWidth: 8, font: { size: chartTheme.legendFontSize } },
                        // Override Legend Click
                        onClick: (e, legendItem, legend) => {
                            handlePieChartClick(legendItem.text);
                        }
                    },
                    datalabels: {
                        display: function (context) {
                            const dataset = context.dataset;
                            const total = dataset.data.reduce((sum, val) => sum + val, 0);
                            return (dataset.data[context.dataIndex] / total) >= chartTheme.dataLabelMinPercentToShow;
                        },
                        formatter: (value, ctx) => {
                            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return ((value / sum) * 100).toFixed(1) + "%";
                        },
                        color: chartTheme.dataLabelColor,
                        font: { weight: "bold", size: chartTheme.pieDataLabelFontSize }
                    }
                }
            }
        });
    }

    const barCanvas = document.getElementById("codeBarChart");
    const barContainer = document.getElementById("barColContainer");
    const chartAreaEl = document.getElementById("chartsContainer");

    // เมื่อไม่มี bar chart (เช่นแท็บ Letter In) ให้ .chart_area จัด donut ไว้กึ่งกลางแนวตั้ง
    // ของพื้นที่ grid ด้านขวา แทนที่จะชิดบนแบบตอนมี bar chart อยู่ด้วย
    if (chartAreaEl) chartAreaEl.classList.toggle("chart_area--center", !!config.hideBarChart);

    if (config.hideBarChart) {
        if (barContainer) barContainer.classList.add("is-hidden");
    } else {
        if (barContainer) barContainer.classList.remove("is-hidden");
        if (barCanvas) {
            barChartInstance = new Chart(barCanvas.getContext("2d"), {
                type: "bar",
                data: { labels: [], datasets: [{ data: [], backgroundColor: chartTheme.barColor, barThickness: chartTheme.barThickness }] },
                plugins: [typeof ChartDataLabels !== "undefined" ? ChartDataLabels : {}],
                options: {
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 1500, easing: 'easeOutQuart' },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const clickedIndex = elements[0].index;
                            const clickedLabel = barChartInstance.data.labels[clickedIndex];
                            selectedCxFilter = (selectedCxFilter === clickedLabel) ? null : clickedLabel;
                        } else {
                            selectedCxFilter = null;
                        }
                        filterActiveTabDocuments();
                    },
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            display: true,
                            anchor: "end",
                            align: "right",
                            formatter: (value) => value.toLocaleString(),
                            font: { weight: "bold", size: chartTheme.barDataLabelFontSize }
                        }
                    },
                    scales: {
                        x: { grid: { color: chartTheme.gridColor }, ticks: { font: { size: chartTheme.axisTickFontSize }, callback: (value) => formatCount(value) } },
                        y: { grid: { display: false }, ticks: { font: { size: chartTheme.axisLabelFontSize, weight: "bold" } } }
                    }
                }
            });
        }
    }
}

function updateChartsDynamic() {
    if (typeof Chart === "undefined") return;
    if (!chartTheme) chartTheme = buildChartTheme();

    // เคลียร์แคชสีเมื่อไม่มีการคลิกเลือกลงบนกราฟ (ทั้ง Pie และ Bar เป็น null)
    // เพื่อให้เมื่อกลับมาสู่โหมดแสดงผลรวม หรือเปลี่ยนแท็บ สีจะรันใหม่เรียง 1-2-3 เสมอไม่ค้าง
    if (!selectedTypeFilter && !selectedCxFilter) {
        pieColorCacheMap = {};
        pieColorCacheIndex = 0;
    }

    // 1. ดึงค่า Filter ทั้งหมดจากหน้าจอ
    const searchInput = document.getElementById("mainSearchInput");
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const checkedCats = Array.from(document.querySelectorAll(".chk_item_cat:checked")).map(c => c.value);
    const hasCatFilter = document.querySelectorAll(".chk_item_cat").length > 0;

    const checkedTypes = Array.from(document.querySelectorAll(".chk_item_type:checked")).map(c => c.value);
    const hasTypeFilter = document.querySelectorAll(".chk_item_type").length > 0;

    const checkedWorkTypes = Array.from(document.querySelectorAll(".chk_item_workType:checked")).map(c => c.value);
    const hasWorkTypeFilter = document.querySelectorAll(".chk_item_workType").length > 0;

    const checkedSource = Array.from(document.querySelectorAll(".chk_item_source:checked")).map(c => c.value);
    const hasSourceFilter = document.querySelectorAll(".chk_item_source").length > 0;

    // 2. ข้อมูลสำหรับ Pie Chart (กรองทุกอย่าง ยกเว้น Type/Source/WorkType ของตัวเอง)
    const docsForPieChart = DOCUMENTS_BY_TAB[currentTab].filter(doc => {
        // ค้นหาแบบ AND หลายคำ (คั่นด้วยช่องว่าง) ผ่าน matchesAllSearchTerms() ใน config.js
        let matchSearch = matchesAllSearchTerms(doc, currentTab, searchQuery);

        let matchCat = !hasCatFilter || checkedCats.includes(doc.category);
        let matchCx = !selectedCxFilter || doc.cxCode === selectedCxFilter;

        // กราฟ Pie ไม่สนใจการเลือกประเภทเอกสาร เพื่อให้คงชิ้นกราฟอื่นๆ ไว้ให้คลิกได้
        return matchSearch && matchCat && matchCx;
    });

    const countsMap = {};
    docsForPieChart.forEach(doc => {
        const code = doc.parsedCode || "Others";
        countsMap[code] = (countsMap[code] || 0) + 1;
    });

    // 3. ข้อมูลสำหรับ Bar Chart (กรองทุกอย่าง ยกเว้น Cx Code ของตัวเอง)
    const docsForBarChart = DOCUMENTS_BY_TAB[currentTab].filter(doc => {
        // ค้นหาแบบ AND หลายคำ (คั่นด้วยช่องว่าง) ผ่าน matchesAllSearchTerms() ใน config.js
        let matchSearch = matchesAllSearchTerms(doc, currentTab, searchQuery);

        let matchCat = !hasCatFilter || checkedCats.includes(doc.category);
        let matchType = !hasTypeFilter || checkedTypes.includes(doc.parsedCode);
        let matchWorkType = !hasWorkTypeFilter || checkedWorkTypes.includes(doc.parsedCode);
        let matchSource = !hasSourceFilter || checkedSource.includes(doc.parsedCode);

        // กราฟ Bar ไม่สนใจการคลิกกรองบน Bar เอง เพื่อให้โชว์ครบทุกแท่ง
        return matchSearch && matchCat && matchType && matchWorkType && matchSource;
    });

    const cxCounts = {};
    docsForBarChart.forEach(doc => {
        if (doc.cxCode && doc.cxCode !== "Others") cxCounts[doc.cxCode] = (cxCounts[doc.cxCode] || 0) + 1;
    });

    updateLatestDateDisplay();

    // 4. อัปเดต Pie Chart
    if (pieChartInstance) {
        const sortedCodes = Object.keys(countsMap).sort((a, b) => countsMap[b] - countsMap[a]);
        let topLabels = sortedCodes.slice(0, chartTheme.pieTopCategoryCount);

        // หากมี selectedTypeFilter อยู่ ต้องบังคับใส่เข้าไปใน Pie Chart เสมอ
        // เพื่อไม่ให้สถานะการเลือกหายไปเมื่อ Filter จาก Bar Chart ทำให้ Count เป็น 0
        if (selectedTypeFilter && !topLabels.includes(selectedTypeFilter)) {
            if (topLabels.length >= chartTheme.pieTopCategoryCount) {
                topLabels = topLabels.slice(0, -1);
            }
            topLabels.push(selectedTypeFilter);

            if (countsMap[selectedTypeFilter] === undefined) {
                countsMap[selectedTypeFilter] = 0;
            }
        }

        const topData = topLabels.map(code => countsMap[code]);
        const othersCount = sortedCodes
            .filter(code => !topLabels.includes(code))
            .reduce((sum, c) => sum + countsMap[c], 0);

        if (othersCount > 0) {
            topLabels.push("Others");
            topData.push(othersCount);
        }

        pieChartInstance.data.labels = topLabels.length ? topLabels : ["ไม่มีข้อมูล"];
        pieChartInstance.data.datasets[0].data = topData.length ? topData : [1];

        // แนบพารามิเตอร์ true เข้าไปเพื่อระบุว่าเป็น Pie Chart (ให้เรียกใช้สีแบบคงที่)
        pieChartInstance.data.datasets[0].backgroundColor = getHighlightColors(chartTheme.paletteColors, pieChartInstance.data.labels, selectedTypeFilter, true);
        pieChartInstance.update();
    }

    // 5. อัปเดต Bar Chart
    if (barChartInstance && currentTab !== "letter") {
        const sortedCx = Object.keys(cxCounts).sort();
        barChartInstance.data.labels = sortedCx.length ? sortedCx : ["-"];
        barChartInstance.data.datasets[0].data = sortedCx.length ? sortedCx.map(c => cxCounts[c]) : [0];

        // แนบพารามิเตอร์ false เข้าไปเพื่อระบุว่าไม่ใช่ Pie Chart
        barChartInstance.data.datasets[0].backgroundColor = getHighlightColors(chartTheme.barColor, barChartInstance.data.labels, selectedCxFilter, false);

        barChartInstance.update();
    }

}

// ---------------------------------------------------------------------------
// 5. URL Hash Sync (อ่าน/เขียนแท็บ + คำค้นหา + ตัวกรองทั้งหมดผ่าน URL hash)
//
// รูปแบบ URL: #tab?q=...&cat=A,B&type=X,Y&workType=...&source=...&cx=CODE
// เขียนเฉพาะพารามิเตอร์ที่ "เลือกไม่ครบทุกตัว" (หรือมีค่า) เท่านั้น เพื่อให้ URL สั้น
//
// การไหลของข้อมูล:
//   1) โหลดหน้า / ผู้ใช้แก้ hash เอง / กด back-forward
//        -> parseHashState() (config.js) อ่านค่าเป็น pendingFilterStateFromURL
//        -> switchTab() เรียก applyFilterStateToTab() เพื่อตั้งค่า UI ให้ตรง แล้ว filter
//   2) ผู้ใช้ติ๊ก/คลิก/พิมพ์เปลี่ยนตัวกรองใดๆ ในหน้าเว็บ
//        -> ทุกจุด (checkbox, "เท่านั้น", chip, bar/pie chart, ช่องค้นหา) เรียก
//             filterActiveTabDocuments() อยู่แล้วในโค้ดเดิม -> ท้ายฟังก์ชันเรียก syncURLHash()
//             เพื่อเขียนสถานะปัจจุบันกลับลง URL ให้คัดลอกไปแชร์ได้ทันที
// ---------------------------------------------------------------------------

// นำสถานะตัวกรองจาก URL (parseHashState) มาตั้งค่า checkbox/chip/ช่องค้นหา/bar chart
// ของแท็บปัจจุบัน แล้ว filter ตาราง+กราฟให้ตรงกันทันที
function applyFilterStateToTab(state) {
    const searchInputEl = document.getElementById("mainSearchInput");
    if (searchInputEl) searchInputEl.value = state.query || "";

    selectedCxFilter = state.cx || null;

    // ตั้ง checkbox ของ dropdown/chip หนึ่งตัวให้ตรงกับ codes ที่ระบุ (null = ไม่ยุ่ง ใช้ default)
    function applyCheckboxState(dropdownId, codes) {
        if (codes === null || codes === undefined) return false;

        const containerEl = document.querySelector(`[data-dropdown-id="${dropdownId}"]`);
        if (!containerEl) return false;

        const boxes = Array.from(containerEl.querySelectorAll(`.chk_item_${dropdownId}`));
        boxes.forEach(box => { box.checked = codes.includes(box.value); });

        const dropdownConfig = TAB_CONFIGS[currentTab].dropdowns.find(d => d.id === dropdownId);

        if (containerEl.classList.contains("chip_filter_group")) {
            syncChipVisualState(containerEl, dropdownId);
            if (dropdownConfig) updateChipHeaderLabel(dropdownConfig, containerEl);
        } else {
            const chkAllEl = containerEl.querySelector(`#chkAll_${dropdownId}`);
            const allChecked = boxes.length > 0 && boxes.every(b => b.checked);
            if (chkAllEl) chkAllEl.checked = allChecked;
            if (dropdownConfig) updateDropdownTitle(dropdownConfig, containerEl);
        }

        updateSelectedTypeFilterFromDOM(dropdownId, containerEl);
        return true;
    }

    if (currentTab === "rfa") {
        // ต้องตั้ง "หมวดงาน" ก่อน เพราะมันไป regenerate ตัวเลือก "ประเภทเอกสาร" ใหม่
        applyCheckboxState("cat", state.cat);
        refreshTypeDropdownByCategory(); // สร้างรายการ type ใหม่ตามหมวดงาน (จะรีเซ็ต type เป็นเลือกทั้งหมดชั่วคราว)
        applyCheckboxState("type", state.type); // ทับด้วยค่าจาก URL อีกที
    } else if (currentTab === "rfi") {
        applyCheckboxState("workType", state.workType);
    } else if (currentTab === "letter") {
        applyCheckboxState("source", state.source);
    }

    filterActiveTabDocuments();
}

// รวม tab + คำค้นหา + ตัวกรองทั้งหมดของแท็บปัจจุบัน เขียนกลับเป็น URL hash เดียว
// ใช้ replaceState เสมอ (ไม่เพิ่ม history entry ทุกครั้งที่พิมพ์/ติ๊กตัวกรอง)
// สร้าง URL จาก origin + pathname ใหม่ทุกครั้ง (ไม่เอา search เดิมติดมา)
// เพื่อกันพารามิเตอร์ตกค้าง เช่นจาก LIFF login ที่หลุดรอดมาจากจุดอื่น
function syncURLHash() {
    const params = new URLSearchParams();

    const searchInputEl = document.getElementById("mainSearchInput");
    const query = searchInputEl ? searchInputEl.value.trim() : "";
    if (query) params.set('q', query);

    TAB_CONFIGS[currentTab].dropdowns.forEach(dropdownConfig => {
        const boxes = Array.from(document.querySelectorAll(`.chk_item_${dropdownConfig.id}`));
        if (boxes.length === 0) return;
        const checked = boxes.filter(b => b.checked).map(b => b.value);
        if (checked.length < boxes.length) {
            params.set(dropdownConfig.id, checked.join(','));
        }
    });

    if (selectedCxFilter) params.set('cx', selectedCxFilter);

    const paramString = params.toString();
    const newHash = paramString ? `#${currentTab}?${paramString}` : `#${currentTab}`;

    const cleanUrl = window.location.origin + window.location.pathname + newHash;

    if (window.location.href !== cleanUrl) {
        history.replaceState(null, '', cleanUrl);
    }
}

// เมื่อ hash เปลี่ยน (ผู้ใช้แก้ URL เอง หรือกด back/forward) ให้สลับแท็บ+ตัวกรองทั้งหมดตาม URL ใหม่
window.addEventListener('hashchange', () => {
    pendingFilterStateFromURL = parseHashState();
    switchTab(pendingFilterStateFromURL.tab);
});


// ---------------------------------------------------------------------------
// Document Link Opener & Background Auth Check / Logging
// ---------------------------------------------------------------------------

window.checkAuthInBackground = async function(linkEl) {
    const docTitle = linkEl.dataset.title;
    console.log(">> เปิดไฟล์ :", docTitle);

    try {
        // 1. ตรวจสอบ Session Guard
        if (Date.now() - window.lastVerifiedAt > window.REVALIDATE_INTERVAL_MS) {
            console.log("⏳ [Debug] กำลังตรวจสอบ Session สิทธิ์การใช้งาน...");
            const isOk = await window.verifyStatus();
            if (!isOk) {
                // หากถูกแบน ฟังก์ชัน verifyStatus จะจัดการเตะออกหรือแสดงหน้าถูกแบนตามเดิม
                return;
            }
        }

        // 2. ส่ง Request บันทึก Log การคลิกไปยัง GAS แบบเงียบๆ (ไม่บล็อกการเปิดไฟล์)
        //    ไม่ส่ง docCategory แล้วตามที่ต้องการ
        if (typeof liff !== "undefined" && typeof AUTH_CONFIG !== "undefined" && AUTH_CONFIG.gasUrl) {
            const profile = await liff.getProfile().catch(() => null);
            if (profile && profile.userId) {
                fetch(AUTH_CONFIG.gasUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                        actionType: 'log_document_click',
                        userId: profile.userId,
                        docTitle: docTitle
                    })
                }).catch(err => console.error("Log fetch error:", err));
            }
        }
    } catch (err) {
        console.error("Background auth check error:", err);
    }
};

// ---------------------------------------------------------------------------
// Session Info Modal (เมนู "ข้อมูลการเข้าใช้")
// ---------------------------------------------------------------------------

function initProfileMenuEvents() {
    if (window.__sessionMenuEventsBound) return;
    window.__sessionMenuEventsBound = true;

    const btn = document.getElementById("btnMySessionInfo");
    if (btn) btn.addEventListener("click", openSessionInfoModal);

    const closeBtn = document.getElementById("btnCloseSessionModal");
    if (closeBtn) closeBtn.addEventListener("click", closeSessionInfoModal);

    const overlay = document.getElementById("sessionInfoModal");
    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeSessionInfoModal();
        });
    }
}
window.initProfileMenuEvents = initProfileMenuEvents;

async function openSessionInfoModal() {
    const userDropdownEl = document.getElementById("userDropdown");
    if (userDropdownEl) userDropdownEl.classList.remove("is-active");

    const modal = document.getElementById("sessionInfoModal");
    const listContainer = document.getElementById("sessionListContainer");
    if (!modal || !listContainer) return;

    modal.classList.remove("is-hidden");
    listContainer.innerHTML = `<div class="session_loading">กำลังโหลดข้อมูลอุปกรณ์...</div>`;

    try {
        if (typeof window.fetchMySessions !== "function") {
            listContainer.innerHTML = `<div class="session_error">ระบบไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง</div>`;
            return;
        }
        const result = await window.fetchMySessions();
        if (!result || (!result.ok && !result.success)) {
            listContainer.innerHTML = `<div class="session_error">ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่</div>`;
            return;
        }
        renderSessionList(result.sessions || [], result.currentSessionId);
    } catch (err) {
        console.error("โหลดรายการ session ล้มเหลว:", err);
        listContainer.innerHTML = `<div class="session_error">เกิดข้อผิดพลาด กรุณาลองใหม่</div>`;
    }
}
window.openSessionInfoModal = openSessionInfoModal;

function closeSessionInfoModal() {
    const modal = document.getElementById("sessionInfoModal");
    if (modal) modal.classList.add("is-hidden");
}
window.closeSessionInfoModal = closeSessionInfoModal;

function renderSessionList(sessions, currentSessionId) {
    const listContainer = document.getElementById("sessionListContainer");
    const countEl = document.getElementById("sessionCount");
    if (!listContainer) return;

    if (countEl) countEl.textContent = sessions.length;

    if (sessions.length === 0) {
        listContainer.innerHTML = `<div class="session_empty">ไม่พบข้อมูลอุปกรณ์ที่ใช้งานอยู่</div>`;
        return;
    }

    listContainer.innerHTML = sessions.map(s => `
        <div class="session_card" data-session-id="${escapeHTML(s.sessionId)}">
            <div class="session_card_main">
                <div class="session_device_label">
                    ${escapeHTML(s.deviceLabel)}
                    ${s.isCurrentDevice || s.sessionId === currentSessionId ? '<span class="badge_current">เครื่องนี้</span>' : ''}
                </div>
                <div class="session_last_seen">เข้าใช้ล่าสุด: ${escapeHTML(s.lastSeenTime)} น.</div>
            </div>
            <button type="button" class="btn_logout_session" data-session-id="${escapeHTML(s.sessionId)}">
                ออกจากระบบ
            </button>
        </div>
    `).join('');

    bindSessionLogoutButtons(currentSessionId);
}

function bindSessionLogoutButtons(currentSessionId) {
    document.querySelectorAll(".btn_logout_session").forEach(btn => {
        btn.addEventListener("click", async () => {
            const targetSessionId = btn.dataset.sessionId;
            const cardEl = btn.closest(".session_card");
            const deviceLabelEl = cardEl ? cardEl.querySelector(".session_device_label") : null;
            const deviceLabel = deviceLabelEl ? deviceLabelEl.innerText.replace("เครื่องนี้", "").trim() : "อุปกรณ์นี้";

            const confirmed = await confirmSessionLogout_(deviceLabel);
            if (!confirmed) return;

            btn.disabled = true;
            btn.textContent = "กำลังดำเนินการ...";

            try {
                const result = await window.requestLogoutSession(targetSessionId);

                if (!result || (!result.ok && !result.success)) {
                    // เปลี่ยน alert เป็น showAlert พร้อมไอคอน error
                    await showAlert("ไม่สามารถออกจากระบบอุปกรณ์นี้ได้ กรุณาลองใหม่", "error", "เกิดข้อผิดพลาด");
                    btn.disabled = false;
                    btn.textContent = "ออกจากระบบ";
                    return;
                }

                if (targetSessionId === currentSessionId) {
                    if (typeof window.clearLocalSessionAndRedirect_ === "function") {
                        window.clearLocalSessionAndRedirect_("คุณออกจากระบบเครื่องนี้เรียบร้อยแล้ว");
                    } else {
                        localStorage.removeItem("app_user_cache");
                        if (typeof liff !== "undefined" && liff.isLoggedIn()) liff.logout();
                        
                        // เปลี่ยน alert เป็น showAlert พร้อมไอคอน success
                        // ต้องมี await เพื่อให้ผู้ใช้กด "ตกลง" ก่อนเว็บจะรีโหลด
                        await showAlert("คุณออกจากระบบเครื่องนี้เรียบร้อยแล้ว", "success", "สำเร็จ");
                        window.location.reload();
                    }
                    return;
                }

                if (cardEl) cardEl.remove();
                const countEl = document.getElementById("sessionCount");
                if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);

                const remainingCards = document.querySelectorAll(".session_card");
                if (remainingCards.length === 0) {
                    const listContainer = document.getElementById("sessionListContainer");
                    if (listContainer) listContainer.innerHTML = `<div class="session_empty">ไม่พบข้อมูลอุปกรณ์ที่ใช้งานอยู่</div>`;
                }

            } catch (err) {
                console.error("logout session ล้มเหลว:", err);
                // เปลี่ยน alert เป็น showAlert พร้อมไอคอน error
                await showAlert("เกิดข้อผิดพลาด กรุณาลองใหม่", "error", "ข้อผิดพลาดของระบบ");
                btn.disabled = false;
                btn.textContent = "ออกจากระบบ";
            }
        });
    });
}

async function confirmSessionLogout_(deviceLabel) {
    const message = `ต้องการออกจากระบบอุปกรณ์ “${deviceLabel}” ใช่หรือไม่?`;
    return await showConfirm(message, "ยืนยันการออกจากระบบ", "ออกจากระบบ", "ยกเลิก", "warning");
}

// =========================================================================
// ปิด Dropdown อัตโนมัติเมื่อมีการ Scroll หน้าจอ (หน่วงเวลา 2 วินาที)
// =========================================================================
let scrollDropdownTimer = null;

window.addEventListener("scroll", function(event) {
    // 1. ตรวจสอบก่อนว่าจุดที่กำลังเลื่อน อยู่ข้างในกล่อง Dropdown หรือไม่
    // (ใช้ event.target เพื่อหา element ที่เกิดการเลื่อน)
    if (event.target && event.target.nodeType === 1) {
        if (event.target.closest('.dropdown_popup')) {
            return; 
        }
    }

    // 2. ถ้าไม่ใช่การเลื่อนใน Dropdown ถึงจะมาทำงานส่วนนับถอยหลัง
    const activePopups = document.querySelectorAll(".dropdown_popup.active");
    
    if (activePopups.length > 0) {     
        scrollDropdownTimer = setTimeout(() => {
            activePopups.forEach(popup => {
                popup.classList.remove("active");
            });
        }, 2000); 
    }
}, true);

// ---------------------------------------------------------------------------
// Info Version Box (แสดง Manifest URL + ความละเอียดหน้าจอปัจจุบัน)
// ---------------------------------------------------------------------------
function updateInfoVersionBox() {
    const versionEl = document.getElementById("infoVersionText");
    const resEl = document.getElementById("infoScreenResText");

    if (versionEl) {
        versionEl.textContent = `Manifest URL: ${APP_VERSION_MANIFEST_URL}`;
    }
    if (resEl) {
        resEl.textContent =
            `ความละเอียดหน้าจอ: ${window.screen.width}x${window.screen.height}` +
            ` (Viewport: ${window.innerWidth}x${window.innerHeight}, DPR: ${window.devicePixelRatio})`;
    }
}
window.addEventListener("resize", updateInfoVersionBox);
