/**
 * ============================================================
 *  RádioCtrl — Utilitários de Interface (UI, Tema, Relógio, Toasts)
 * ============================================================
 */
(function (global) {
    'use strict';

    const THEME_KEY = 'radioctrl_theme';
    const SIDEBAR_KEY = 'radioctrl_sidebar_collapsed';

    // --- Tema (Claro padrão / Escuro opcional) ---
    function initTheme() {
        const saved = localStorage.getItem(THEME_KEY) || 'light';
        applyTheme(saved);
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
        const label = document.getElementById('themeLabel');
        if (label) label.textContent = theme === 'dark' ? 'Modo Claro' : 'Modo Escuro';
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // --- Sidebar Colapsável ---
    function initSidebar() {
        const collapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';
        const app = document.getElementById('appShell');
        if (app && collapsed) app.classList.add('sidebar-collapsed');
    }

    function toggleSidebar() {
        const app = document.getElementById('appShell');
        if (!app) return;
        const isCollapsed = app.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_KEY, String(isCollapsed));
    }

    // --- Relógio Digital ---
    function startClock() {
        updateClock();
        setInterval(updateClock, 1000);
    }

    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${h}:${m}:${s}`;

        const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
        const dateStr = `${days[now.getDay()]}, ${String(now.getDate()).padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
        const shortDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

        const clockTimeEl = document.getElementById('clockTime');
        const clockDateEl = document.getElementById('clockDate');
        const mobileClockEl = document.getElementById('mobileClockTime');

        if (clockTimeEl) clockTimeEl.textContent = timeStr;
        if (clockDateEl) clockDateEl.textContent = dateStr;
        if (mobileClockEl) mobileClockEl.textContent = `${h}:${m} · ${shortDate}`;
    }

    // --- Feedback Sonoro Sutil (Web Audio API) ---
    let audioCtx = null;
    function playBeep(type = 'success') {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            if (type === 'success') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1174.66, audioCtx.currentTime + 0.09);
                gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.17);
            } else {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(240, audioCtx.currentTime);
                osc.frequency.setValueAtTime(180, audioCtx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.23);
            }
        } catch (_) {
            // Silencioso se navegador bloquear áudio
        }
    }

    // --- Toast Notifications ---
    function showToast(message, type = 'info', duration = 3800) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const icons = {
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
            warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-text">${escHtml(message)}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 260);
        }, duration);
    }

    function showBannerFeedback(el, message, type) {
        if (!el) return;
        el.textContent = message;
        el.className = `feedback-banner ${type} visible`;
        clearTimeout(el._timer);
        el._timer = setTimeout(() => clearBannerFeedback(el), 5500);
    }

    function clearBannerFeedback(el) {
        if (!el) return;
        el.textContent = '';
        el.className = 'feedback-banner';
    }

    // --- Modais ---
    function openModal(id) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('open');
            if (!document.querySelector('.modal-overlay.open')) {
                document.body.style.overflow = '';
            }
        }
    }

    // --- Formatação & Status ---
    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDateTime(value) {
        if (!value) return '—';
        try {
            const d = new Date(value);
            if (isNaN(d.getTime())) return escHtml(value);
            return d.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return escHtml(value);
        }
    }

    function normalizeStatus(status) {
        if (!status) return '';
        const s = String(status).toLowerCase().trim();
        if (s.includes('dispon')) return 'disponivel';
        if (s.includes('uso') || s.includes('retirad')) return 'em uso';
        if (s.includes('manut')) return 'manutencao';
        return s;
    }

    function getStatusMeta(statusNorm) {
        if (statusNorm === 'disponivel') {
            return { label: 'Disponível', cls: 'badge-disponivel' };
        }
        if (statusNorm === 'em uso') {
            return { label: 'Em Uso', cls: 'badge-em-uso' };
        }
        if (statusNorm === 'manutencao') {
            return { label: 'Manutenção', cls: 'badge-manutencao' };
        }
        return { label: statusNorm || '—', cls: 'badge-neutral' };
    }

    function getMovTipoMeta(tipoRaw) {
        const t = String(tipoRaw || '').toLowerCase().trim();
        if (t.includes('retir')) return { label: 'Retirada', cls: 'badge-em-uso' };
        if (t.includes('manut') && t.includes('retorno')) return { label: 'Retorno Manut.', cls: 'badge-disponivel' };
        if (t.includes('manut')) return { label: 'Manutenção', cls: 'badge-manutencao' };
        return { label: 'Devolução', cls: 'badge-disponivel' };
    }

    function animateCounter(el, target) {
        if (!el) return;
        const start = parseInt(el.textContent, 10) || 0;
        if (start === target) {
            el.textContent = target;
            return;
        }
        const duration = 420;
        const startTime = performance.now();
        function step(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(start + (target - start) * eased);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    global.RadioCtrlUI = {
        initTheme,
        toggleTheme,
        initSidebar,
        toggleSidebar,
        startClock,
        playBeep,
        showToast,
        showBannerFeedback,
        clearBannerFeedback,
        openModal,
        closeModal,
        escHtml,
        formatDateTime,
        normalizeStatus,
        getStatusMeta,
        getMovTipoMeta,
        animateCounter
    };
})(window);
