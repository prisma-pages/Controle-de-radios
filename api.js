/**
 * ============================================================
 *  RádioCtrl — Camada de Integração Exclusiva com Google Apps Script
 * ============================================================
 */
(function (global) {
    'use strict';

    const API_URL = 'https://script.google.com/macros/s/AKfycbwSGxzUSjm1DUzZuVg0C5ehluuX-MeYjpImbcING0_jx5BRCiQjpKVIuEmsf8fY9NN0/exec';

    let syncStatus = 'syncing'; // 'syncing' | 'online' | 'error'
    let lastSyncAt = null;
    const listeners = new Set();

    function getSyncState() {
        return { status: syncStatus, lastSyncAt };
    }

    function onSyncChange(cb) {
        listeners.add(cb);
    }

    function notifySync(status) {
        syncStatus = status;
        if (status === 'online') lastSyncAt = new Date();
        listeners.forEach(cb => {
            try { cb(getSyncState()); } catch (_) {}
        });
    }

    async function request({ method = 'GET', data = {} }) {
        notifySync('syncing');

        try {
            let response;
            if (method === 'GET') {
                const qs = new URLSearchParams(data).toString();
                const url = qs ? `${API_URL}?${qs}` : API_URL;
                response = await fetch(url, { method: 'GET' });
            } else {
                response = await fetch(API_URL, {
                    method: 'POST',
                    body: JSON.stringify(data),
                    headers: { 'Content-Type': 'text/plain' }
                });
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const json = await response.json();
            notifySync('online');
            return json;
        } catch (err) {
            notifySync('error');
            throw err;
        }
    }

    global.RadioCtrlAPI = {
        request,
        getSyncState,
        onSyncChange
    };
})(window);
