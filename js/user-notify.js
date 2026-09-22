/**
 * user-notify.js — ระบบแจ้งเตือนผู้ใช้งาน (User Notification Bubble)
 * แสดงกล่องแจ้งเตือนกว้าง 150px ด้านซ้ายของ user_profile_area
 * คลี่/ยุบเลียนแบบ update_notify_bubble และดึงข้อมูลจาก data/notify.json
 *
 * สถานะผู้ใช้ที่รองรับ:
 *   guest   = ยังไม่เคยลงทะเบียน (bpnp_reg_status ไม่มีค่า หรือ isGuest = true)
 *   pending = ลงทะเบียนแล้ว รออนุมัติ (bpnp_reg_status === 'pending')
 *   active  = อนุมัติแล้ว มี sessionId จริง (ไม่ใช่ guest)
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    let notifyConfig       = null;
    let activeStatusConfig = null;
    let initialized        = false;

    let bubbleEl    = null;
    let viewportEl  = null;
    let trackEl     = null;
    let prefixEl    = null;
    let actionEl    = null;
    let badgeEl     = null;

    let bubbleState     = 'idle'; // idle | pending | open
    let showTimerId     = null;
    let marqueeTimerId  = null;
    let hideTimerId     = null;
    let cleanupTimerId  = null;
    let marqueeAnims    = [];
    let marqueeToken    = 0;

    // -----------------------------------------------------------------------
    // ระบุสถานะผู้ใช้ปัจจุบัน: 'guest' | 'pending' | 'active'
    // -----------------------------------------------------------------------
    function getCurrentUserStatus() {
        try {
            const cachedUser = (typeof getCachedUser === 'function') ? getCachedUser() : null;
            const isGuest = !cachedUser || !cachedUser.sessionId || cachedUser.isGuest;
            if (isGuest) {
                const regStatus = localStorage.getItem('bpnp_reg_status');
                return regStatus === 'pending' ? 'pending' : 'guest';
            }
            return 'active';
        } catch (e) {
            return 'guest';
        }
    }

    // -----------------------------------------------------------------------
    // โหลด data/notify.json
    // -----------------------------------------------------------------------
    async function loadNotifyData() {
        try {
            const res = await fetch('data/notify.json?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            console.warn('[user-notify] โหลด data/notify.json ไม่สำเร็จ', err);
            return null;
        }
    }

    // -----------------------------------------------------------------------
    // ผูก DOM Elements (ทั้ง Bubble และ Badge มีใน HTML แล้ว)
    // -----------------------------------------------------------------------
    function bindDOMElements() {
        bubbleEl   = document.getElementById('userNotifyBubble');
        viewportEl = bubbleEl  ? bubbleEl.querySelector('.user_notify_viewport')  : null;
        trackEl    = bubbleEl  ? bubbleEl.querySelector('.user_notify_track')     : null;
        prefixEl   = bubbleEl  ? bubbleEl.querySelector('.user_notify_prefix')    : null;
        actionEl   = bubbleEl  ? bubbleEl.querySelector('.user_notify_action')    : null;
        badgeEl    = document.getElementById('userNotifyBadge');

        return !!(bubbleEl && viewportEl && trackEl && prefixEl && actionEl && badgeEl);
    }

    // -----------------------------------------------------------------------
    // Timer helpers
    // -----------------------------------------------------------------------
    function clearNotifyTimers() {
        [showTimerId, marqueeTimerId, hideTimerId, cleanupTimerId].forEach(id => {
            if (id) clearTimeout(id);
        });
        showTimerId = marqueeTimerId = hideTimerId = cleanupTimerId = null;
    }

    function cancelMarqueeAnims() {
        marqueeToken++;
        marqueeAnims.forEach(a => { try { a.cancel(); } catch (e) {} });
        marqueeAnims = [];
    }

    function stopNotifyMarquee() {
        cancelMarqueeAnims();
        if (trackEl)  trackEl.style.transform = '';
        if (bubbleEl) bubbleEl.classList.remove('is-scrolling');
    }

    // -----------------------------------------------------------------------
    // Marquee
    // -----------------------------------------------------------------------
    function isMarqueeAvailable() {
        const cfg = (notifyConfig && notifyConfig.config) || {};
        return !!cfg.marqueeEnabled
            && !!trackEl
            && typeof trackEl.animate === 'function';
    }

    function startNotifyMarquee() {
        marqueeTimerId = null;
        cancelMarqueeAnims();
        if (!isMarqueeAvailable() || !viewportEl || !trackEl) return;

        const cfg     = (notifyConfig && notifyConfig.config) || {};
        const viewW   = viewportEl.clientWidth;
        const textW   = trackEl.offsetWidth;

        // ถ้าข้อความสั้นพอดีหรือสั้นกว่ากล่อง ไม่ต้องวิ่ง
        if (textW <= viewW && (!actionEl || actionEl.hidden || !actionEl.textContent.trim())) {
            if (bubbleEl) bubbleEl.classList.add('is-static');
            return;
        }

        if (bubbleEl) bubbleEl.classList.add('is-scrolling');

        const finalX = (!actionEl || actionEl.hidden) ? 0 : -(actionEl.offsetLeft);
        const loops  = Math.max(1, Math.floor(cfg.marqueeLoops) || 2);

        const passes = [];
        for (let i = 0; i < loops - 1; i++) passes.push({ from: viewW, to: -textW });
        passes.push({ from: viewW, to: finalX });

        const speed = Math.max(10, Number(cfg.marqueeSpeedPxPerSec) || 50);
        const token = marqueeToken;

        const runPass = (index) => {
            if (token !== marqueeToken) return;
            const { from, to } = passes[index];
            const isLast       = index === passes.length - 1;
            const duration     = Math.max(1, (Math.abs(from - to) / speed) * 1000);

            const anim = trackEl.animate(
                [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
                { duration, easing: 'linear', fill: 'forwards' }
            );
            marqueeAnims.push(anim);

            anim.onfinish = isLast
                ? () => { if (bubbleEl) bubbleEl.classList.remove('is-scrolling'); }
                : () => runPass(index + 1);
        };

        runPass(0);
    }

    // -----------------------------------------------------------------------
    // Render ข้อความและธีม
    // -----------------------------------------------------------------------
    function renderNotifyText() {
        if (!activeStatusConfig || !prefixEl || !actionEl || !bubbleEl) return;

        const prefixText = (activeStatusConfig.text       || '').trim();
        const actText    = (activeStatusConfig.actionText || '').trim();

        prefixEl.textContent = prefixText;
        prefixEl.hidden      = !prefixText;
        actionEl.textContent = actText;
        actionEl.hidden      = !actText;

        // Cursor: มือชี้เมื่อคลิกได้, ค้างไว้เมื่อไม่มี action
        bubbleEl.style.cursor = activeStatusConfig.actionType === 'openRegisterModal'
            ? 'pointer' : 'default';

        // ธีมสี: ลบ class theme-* เดิมก่อน แล้วเพิ่มใหม่
        bubbleEl.className = 'user_notify_bubble';
        const theme = activeStatusConfig.theme || 'warning';
        bubbleEl.classList.add('theme-' + theme);
    }

    // -----------------------------------------------------------------------
    // เปิด/ปิด Bubble
    // -----------------------------------------------------------------------
    function closeUserNotifyBubble() {
        clearNotifyTimers();
        bubbleState = 'idle';
        if (bubbleEl) bubbleEl.classList.remove('is-open');

        const cfg    = (notifyConfig && notifyConfig.config) || {};
        const foldMs = cfg.foldMs || 400;
        cleanupTimerId = setTimeout(() => {
            cleanupTimerId = null;
            stopNotifyMarquee();
        }, foldMs + 50);
    }

    function playUserNotifyBubble(delayMs) {
        if (!bubbleEl || !activeStatusConfig) return;
        const cfg       = (notifyConfig && notifyConfig.config) || {};
        const foldMs    = cfg.foldMs    || 400;
        const displayMs = cfg.displayMs || 10000;

        if (delayMs === undefined) delayMs = foldMs;

        clearNotifyTimers();
        bubbleState = 'pending';
        bubbleEl.classList.remove('is-open', 'is-scrolling', 'is-static');

        showTimerId = setTimeout(() => {
            showTimerId = null;

            stopNotifyMarquee();
            renderNotifyText();

            const canMarquee = isMarqueeAvailable();
            if (canMarquee && viewportEl && trackEl) {
                trackEl.style.transform = `translateX(${viewportEl.clientWidth}px)`;
            } else {
                bubbleEl.classList.add('is-static');
            }

            bubbleEl.classList.add('is-open');
            bubbleState = 'open';

            if (canMarquee) {
                marqueeTimerId = setTimeout(startNotifyMarquee, foldMs);
            }
            hideTimerId = setTimeout(closeUserNotifyBubble, displayMs);
        }, Math.max(0, delayMs));
    }

    // -----------------------------------------------------------------------
    // ผูก Event: คลิก Bubble และ Hover เพื่อ Replay
    // -----------------------------------------------------------------------
    function bindEvents() {
        if (!bubbleEl) return;

        // คลิกที่ Bubble → openRegisterModal (สำหรับ guest)
        bubbleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeStatusConfig && activeStatusConfig.actionType === 'openRegisterModal') {
                const btnRegister = document.getElementById('btnOpenRegisterModal');
                if (btnRegister) btnRegister.click();
            }
        });

        // Hover รูปโปรไฟล์ → Replay (ไม่ใช้ CSS :hover แสดงชื่อแล้ว)
        const profileArea = document.getElementById('userProfileArea');
        if (profileArea && !profileArea.__userNotifyHoverBound) {
            profileArea.__userNotifyHoverBound = true;
            profileArea.addEventListener('pointerenter', (event) => {
                if (event.pointerType === 'touch') return;
                if (!notifyConfig || !notifyConfig.enabled) return;
                if (!activeStatusConfig || !activeStatusConfig.enabled) return;
                if (bubbleState !== 'idle') return; // กำลังเล่นอยู่ → ไม่ Replay ซ้ำ
                playUserNotifyBubble(0);
            });
        }
    }

    // -----------------------------------------------------------------------
    // initUserNotify — Entry Point (ถูกเรียกจาก auth.js showApp())
    // -----------------------------------------------------------------------
    async function initUserNotify() {
        if (initialized) return;
        initialized = true;

        if (!bindDOMElements()) {
            console.warn('[user-notify] ไม่พบ DOM elements ที่จำเป็น');
            return;
        }

        const data = await loadNotifyData();
        if (!data || !data.enabled) {
            if (badgeEl) badgeEl.classList.add('is-hidden');
            return;
        }

        notifyConfig = data;

        const status = getCurrentUserStatus();
        activeStatusConfig = data.notifications && data.notifications[status];

        if (!activeStatusConfig || !activeStatusConfig.enabled) {
            if (badgeEl) badgeEl.classList.add('is-hidden');
            return;
        }

        // ตั้งค่า CSS variable ระยะ fold
        const foldMs = (data.config && data.config.foldMs) || 400;
        bubbleEl.style.setProperty('--user-notify-fold-ms', foldMs + 'ms');

        // แสดง Badge สีส้ม
        if (badgeEl) badgeEl.classList.remove('is-hidden');

        // ผูก events
        bindEvents();

        // เล่น Bubble ครั้งแรก (delay 500ms หลัง app load)
        playUserNotifyBubble(500);
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------
    window.initUserNotify       = initUserNotify;
    window.playUserNotifyBubble = playUserNotifyBubble;
    window.closeUserNotifyBubble = closeUserNotifyBubble;

})();
