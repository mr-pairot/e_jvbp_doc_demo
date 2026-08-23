/**
 * about-popup.js — ระบบสารบรรณอิเล็กทรอนิกส์
 * Popup ข้อมูลผู้พัฒนา (คลิกที่ข้อความ "mr.pairot" ใต้ Footer)

 * ต้องโหลดหลัง config.js, data-service.js, ui-render.js (ไม่ได้ใช้ตัวแปร/ฟังก์ชันจากไฟล์เหล่านั้น
 * แต่เรียงไว้ท้ายสุดตามลำดับการโหลด script ของระบบ)

 * หมวดหมู่ในไฟล์นี้:
 *   1. Initialization — ผูก Event กับข้อความ "mr.pairot"
 *   2. Open Modal — สร้าง หรือ แสดง Modal
 *   3. Close Modal — ซ่อน Modal พร้อม Animation
 *   4. Purpose Scroll — เลื่อนข้อความวัตถุประสงค์อัตโนมัติ หยุดเมื่อ hover/touch
 * ========================================================================= */

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const attribution = document.querySelector(".dev_attribution");
    if (attribution) {
        attribution.title = "คลิกเพื่อดูข้อมูลผู้พัฒนา";
        attribution.addEventListener("click", openAboutModal);
    }
});

// ---------------------------------------------------------------------------
// 2. Open Modal
// ---------------------------------------------------------------------------
function openAboutModal() {
    let modal = document.getElementById("aboutModal");

    if (modal) {
        // Modal มีอยู่แล้ว: แสดงซ้ำ แล้วเริ่ม auto-scroll ใหม่
        modal.classList.add("is-active");
        startPurposeScroll();
        return;
    }

    // Modal ยังไม่มี: สร้างใหม่ แล้วแทรกใน DOM
    const modalHtml = `
    <div id="aboutModal" class="about-modal-overlay">
        <div class="about-modal-content">

            <button type="button" class="about-close-btn" aria-label="ปิด" onclick="closeAboutModal()">&times;</button>

            <!-- ===== ข้อมูลผู้พัฒนา + ช่องทางติดต่อ ===== -->
            <div class="about-header-top">
                <div class="profile-img-container skeleton">
                    <img src="img/profile.webp" alt="Mr.Pairot" id="devProfileImg"
                         width="100" height="100" loading="lazy"
                         onload="this.classList.add('loaded'); this.parentElement.classList.remove('skeleton')"
                         onerror="this.src='https://via.placeholder.com/200x200?text=Dev';
                                  this.classList.add('loaded'); this.parentElement.classList.remove('skeleton')">
                </div>

                <div class="dev-info-box">
                    <h2>นายไพโรจน์ หุ่ยปาน</h2>
                    <p class="dev-role">Software Developer</p>

                    <div class="dev-contact-group">
                        <a href="mailto:mr.pairot@gmail.com" class="dev-email">
                            <span>✉️</span><span>Mr.Pairot@gmail.com</span>
                        </a>
                        <a href="https://line.me/ti/p/~mr.pairot2016" target="_blank" rel="noopener" class="dev-line-btn">
                            <span>💬</span><span>ทักไลน์ผู้พัฒนา</span>
                        </a>
                    </div>
                </div>
            </div>

            <!-- ===== วัตถุประสงค์โครงการ (Auto-Scroll) ===== -->
            <div class="dev-purpose-box">
                <h3><span>ℹ️</span> รายละเอียดและวัตถุประสงค์</h3>

                <div class="purpose-scroll-container" id="purposeScroll">
                    <p class="purpose-text">
                        <strong>รายละเอียดการพัฒนา:</strong><br>
                        ระบบสารบรรณอิเล็กทรอนิกส์นี้พัฒนาขึ้นด้วย HTML, CSS และ JavaScript
                        เชื่อมต่อข้อมูลจาก Google Sheets แบบเรียลไทม์ เพื่อรวบรวมและแสดงผลเอกสาร
                        ประเภท RFA, RFI และ Letter In พร้อมระบบค้นหา กรองข้อมูล และกราฟสรุปยอดเอกสาร
                    </p>
                    <p class="purpose-text sm">
                        <strong>วัตถุประสงค์:</strong><br>
                        เพื่อใช้เป็นเครื่องมือสนับสนุนการทำงานภายในโครงการของ
                        AS - CH and Associates Joint Venture ช่วยให้ทีมงานสามารถติดตามสถานะเอกสาร
                        Request for Approval (RFA), Request for Information (RFI)
                        และหนังสือรับเข้า (Letter In) ได้อย่างสะดวก รวดเร็ว และเป็นระบบมากขึ้น
                    </p>
                    <div class="purpose-cta">
                        <p>
                            <strong>พบปัญหาการใช้งานและมีข้อแนะนำ:</strong><br>
                            ทักแชทไลน์แจ้งข้อมูลได้เลย และยินดีที่ได้ร่วมกันพัฒนาระบบไปด้วยกันครับ
                        </p>
                    </div>
                </div>
            </div>

            <div class="about-footer">
                ระบบสารบรรณอิเล็กทรอนิกส์ &copy; 2026
            </div>

        </div>
    </div>`;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
    modal = document.getElementById("aboutModal");

    // เปิดในเฟรมถัดไปเพื่อให้ transition (opacity/scale) ทำงาน
    requestAnimationFrame(() => modal.classList.add("is-active"));

    // ปิด Modal เมื่อคลิกที่ overlay (นอกกล่องเนื้อหา)
    modal.addEventListener("click", (e) => {
        if (e.target.id === "aboutModal") closeAboutModal();
    });

    startPurposeScroll();
}

// ---------------------------------------------------------------------------
// 3. Close Modal
// ---------------------------------------------------------------------------
function closeAboutModal() {
    const modal = document.getElementById("aboutModal");
    if (!modal) return;

    modal.classList.remove("is-active");
    if (purposeScrollRAF) cancelAnimationFrame(purposeScrollRAF);
}

// ---------------------------------------------------------------------------
// 4. Purpose Scroll (เลื่อนข้อความวัตถุประสงค์อัตโนมัติ หยุดเมื่อ hover/touch)
// ---------------------------------------------------------------------------
let purposeScrollRAF;

function startPurposeScroll() {
    const el = document.getElementById("purposeScroll");
    if (!el) return;

    if (purposeScrollRAF) cancelAnimationFrame(purposeScrollRAF);
    el.scrollTop = 0;

    let isPaused = true;
    let currentY = 0;
    const speed = 0.2;

    if (!el.hasAttribute("data-scroll-init")) {
        el.addEventListener("mouseenter", () => { isPaused = true; });
        el.addEventListener("mouseleave", () => { isPaused = false; });
        el.addEventListener("touchstart", () => { isPaused = true; }, { passive: true });
        el.addEventListener("touchend", () => { isPaused = false; });
        el.setAttribute("data-scroll-init", "true");
    }

    setTimeout(() => { isPaused = false; }, 1500);

    function step() {
        if (!isPaused) {
            currentY += speed;
            el.scrollTop = currentY;

            if (Math.abs(currentY - el.scrollTop) > speed + 1) {
                currentY = el.scrollTop;
            }
            if (Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight) {
                return; // สุดข้อความแล้ว หยุดลูป
            }
        }
        purposeScrollRAF = requestAnimationFrame(step);
    }

    purposeScrollRAF = requestAnimationFrame(step);
}

