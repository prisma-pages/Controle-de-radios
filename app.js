/**
 * ============================================================
 *  RádioCtrl — Controlador Principal da Aplicação
 *  Marlon Fernandes & Larissa Teixeira — 2026
 * ============================================================
 */
(function (global) {
    'use strict';

    const ADMIN_PASSWORD = '@Ferrovias';
    const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos
    const PAGE_SIZE = 15;

    const API = global.RadioCtrlAPI;
    const UI = global.RadioCtrlUI;

    let inactivityTimer = null;

    const state = {
        currentScreen: 'dashboard',
        adminAuthorized: false,
        radios: [],
        baterias: [],
        colaboradores: [],
        movimentacoes: [],
        dashFilterCategory: 'TODOS', // 'TODOS' | 'RADIO' | 'BATERIA'
        dashFilterStatus: 'todos',     // 'todos' | 'disponivel' | 'em uso' | 'manutencao'
        dashSearch: '',
        cadastroTab: 'radios',
        cadastroSearchRadios: '',
        cadastroSearchBaterias: '',
        cadastroSearchColabs: '',
        histSearch: '',
        histCategoria: 'TODOS',
        histTipo: 'todos',
        histDataInicio: '',
        histDataFim: '',
        histPage: 1,
        pendingManut: null,     // { id, categoria, novoStatus }
        pendingEdit: null,      // { type: 'radio'|'bateria'|'colab', originalKey }
        pendingDelete: null     // { type: 'radio'|'bateria'|'colab', key, label }
    };

    // ============================================================
    //  INICIALIZAÇÃO
    // ============================================================
    document.addEventListener('DOMContentLoaded', () => {
        UI.initTheme();
        UI.initSidebar();
        UI.startClock();
        API.onSyncChange(updateConnectionBadge);
        updateConnectionBadge(API.getSyncState());
        bindEvents();
        loadDashboardData(true);
    });

    function bindEvents() {
        const inputRadio = document.getElementById('inputRadio');
        const inputColab = document.getElementById('inputColaborador');
        const inputObs = document.getElementById('inputObservacao');

        if (inputRadio) {
            inputRadio.addEventListener('input', handleEquipPreview);
            inputRadio.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (inputColab && !inputColab.value.trim()) {
                        inputColab.focus();
                    } else {
                        registrarMovimentacao();
                    }
                }
            });
        }

        if (inputColab) {
            inputColab.addEventListener('input', () => renderColabAutocomplete(inputColab.value));
            inputColab.addEventListener('focus', () => renderColabAutocomplete(inputColab.value));
            inputColab.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    hideColabAutocomplete();
                    registrarMovimentacao();
                } else if (e.key === 'Escape') {
                    hideColabAutocomplete();
                }
            });
        }

        if (inputObs) {
            inputObs.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    registrarMovimentacao();
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-wrapper')) {
                hideColabAutocomplete();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach(m => UI.closeModal(m.id));
            }
        });

        // Monitora atividade para timeout de segurança nas abas restritas
        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
            document.addEventListener(evt, handleUserActivity, { passive: true });
        });
    }

    // ============================================================
    //  NAVEGAÇÃO SPA & BLOQUEIO IMEDIATO
    // ============================================================
    function showScreen(screenName) {
        // Sempre reseta a autenticação ao sair ou alternar entre abas restritas
        revokeAdminSession();

        state.currentScreen = screenName;

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('[data-nav]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-nav') === screenName);
        });

        const target = document.getElementById(`screen-${screenName}`);
        if (target) target.classList.add('active');

        if (screenName === 'dashboard') {
            loadDashboardData(false);
            setTimeout(() => {
                const el = document.getElementById('inputRadio');
                if (el && window.innerWidth >= 768) el.focus();
            }, 80);
        } else if (screenName === 'historico') {
            renderAuthGate('historico');
        } else if (screenName === 'cadastro') {
            renderAuthGate('cadastro');
        }
    }

    // ============================================================
    //  CONEXÃO / SINCRONIZAÇÃO API
    // ============================================================
    function updateConnectionBadge(syncState) {
        const dot = document.getElementById('connDot');
        const text = document.getElementById('connText');
        const mobileBadge = document.getElementById('mobileConnBadge');

        const st = syncState?.status || 'syncing';
        let label = 'Sincronizando...';
        let shortLabel = 'Sync';

        if (st === 'online') {
            label = 'API Conectada';
            shortLabel = 'Online';
        } else if (st === 'error') {
            label = 'Erro de Conexão';
            shortLabel = 'Offline';
        }

        if (dot) dot.className = `conn-dot ${st}`;
        if (text) text.textContent = label;
        if (mobileBadge) mobileBadge.textContent = shortLabel;
    }

    // ============================================================
    //  UTILITÁRIO: BUSCA UNIFICADA DE EQUIPAMENTO (RÁDIO / BATERIA)
    // ============================================================
    function getAllEquipments() {
        const radios = state.radios.map(r => ({ ...r, categoria: 'RADIO' }));
        const baterias = state.baterias.map(b => ({ ...b, categoria: 'BATERIA' }));
        return [...radios, ...baterias];
    }

    function findEquipmentById(id) {
        const q = (id || '').trim().toLowerCase();
        if (!q) return null;
        const radio = state.radios.find(r => r.id.toLowerCase() === q);
        if (radio) return { ...radio, categoria: 'RADIO' };
        const bateria = state.baterias.find(b => b.id.toLowerCase() === q);
        if (bateria) return { ...bateria, categoria: 'BATERIA' };
        return null;
    }

    function getCategoryLabel(cat) {
        return String(cat || '').toUpperCase() === 'BATERIA' ? 'Bateria' : 'Rádio';
    }

    // ============================================================
    //  TELA 1: DASHBOARD
    // ============================================================
    async function loadDashboardData(focusEquip = false) {
        const refreshBtn = document.getElementById('btnRefreshDash');
        if (refreshBtn) refreshBtn.classList.add('spinning');

        try {
            const [radiosRes, bateriasRes, colabsRes] = await Promise.all([
                API.request({ method: 'GET', data: { action: 'getRadios' } }),
                API.request({ method: 'GET', data: { action: 'getBaterias' } }).catch(() => ({ baterias: [] })),
                API.request({ method: 'GET', data: { action: 'getColaboradores' } })
            ]);

            state.radios = radiosRes?.radios || [];
            state.baterias = bateriasRes?.baterias || [];
            state.colaboradores = colabsRes?.colaboradores || [];

            updateKPIs();
            renderDashboardTable();
            handleEquipPreview();

            if (focusEquip && window.innerWidth >= 768) {
                document.getElementById('inputRadio')?.focus();
            }
        } catch (err) {
            console.error(err);
            UI.showToast(`Erro ao carregar dados da API: ${err.message}`, 'error');
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        }
    }

    function updateKPIs() {
        // Rádios (Total sem % e barra)
        const rTotal = state.radios.length;
        const rDisp = state.radios.filter(r => UI.normalizeStatus(r.status) === 'disponivel').length;
        const rUso = state.radios.filter(r => UI.normalizeStatus(r.status) === 'em uso').length;
        const rManut = state.radios.filter(r => UI.normalizeStatus(r.status) === 'manutencao').length;

        UI.animateCounter(document.getElementById('kpiTotal'), rTotal);
        UI.animateCounter(document.getElementById('kpiDisponivel'), rDisp);
        UI.animateCounter(document.getElementById('kpiEmUso'), rUso);
        UI.animateCounter(document.getElementById('kpiManutencao'), rManut);

        const pct = (n, tot) => (tot > 0 ? Math.round((n / tot) * 100) : 0);
        setProgress('barDisponivel', 'pctDisponivel', pct(rDisp, rTotal));
        setProgress('barEmUso', 'pctEmUso', pct(rUso, rTotal));
        setProgress('barManutencao', 'pctManutencao', pct(rManut, rTotal));

        // Baterias
        const bTotal = state.baterias.length;
        const bDisp = state.baterias.filter(b => UI.normalizeStatus(b.status) === 'disponivel').length;
        const bUso = state.baterias.filter(b => UI.normalizeStatus(b.status) === 'em uso').length;
        const bManut = state.baterias.filter(b => UI.normalizeStatus(b.status) === 'manutencao').length;

        UI.animateCounter(document.getElementById('kpiBatTotal'), bTotal);
        UI.animateCounter(document.getElementById('kpiBatDisponivel'), bDisp);
        UI.animateCounter(document.getElementById('kpiBatEmUso'), bUso);
        UI.animateCounter(document.getElementById('kpiBatManutencao'), bManut);

        setPctText('pctBatDisponivel', pct(bDisp, bTotal));
        setPctText('pctBatEmUso', pct(bUso, bTotal));
        setPctText('pctBatManutencao', pct(bManut, bTotal));
    }

    function setProgress(barId, pctId, value) {
        const bar = document.getElementById(barId);
        if (bar) bar.style.width = `${value}%`;
        setPctText(pctId, value);
    }

    function setPctText(pctId, value) {
        const label = document.getElementById(pctId);
        if (label) label.textContent = `${value}%`;
    }

    function filterDashboardByKpi(categoria, status) {
        state.dashFilterCategory = categoria;
        state.dashFilterStatus = status;
        syncDashboardFilterUI();
        renderDashboardTable();
    }

    function setDashboardCategoryFilter(categoria) {
        state.dashFilterCategory = categoria;
        syncDashboardFilterUI();
        renderDashboardTable();
    }

    function setDashboardStatusFilter(status) {
        state.dashFilterStatus = status;
        syncDashboardFilterUI();
        renderDashboardTable();
    }

    function syncDashboardFilterUI() {
        document.querySelectorAll('[data-kpi]').forEach(card => {
            const grp = card.getAttribute('data-kpi-group').toUpperCase();
            const st = card.getAttribute('data-kpi');
            card.classList.toggle('kpi-active', grp === state.dashFilterCategory && st === state.dashFilterStatus);
        });
        document.querySelectorAll('[data-cat]').forEach(pill => {
            pill.classList.toggle('active', pill.getAttribute('data-cat') === state.dashFilterCategory);
        });
        document.querySelectorAll('[data-status]').forEach(pill => {
            pill.classList.toggle('active', pill.getAttribute('data-status') === state.dashFilterStatus);
        });
    }

    function onDashboardSearch(val) {
        state.dashSearch = (val || '').trim().toLowerCase();
        renderDashboardTable();
    }

    function renderDashboardTable() {
        const tbody = document.getElementById('tbodyRadios');
        const mobileList = document.getElementById('mobileRadiosList');
        const countEl = document.getElementById('dashTableCount');

        const all = getAllEquipments();
        const filtered = all.filter(item => {
            if (state.dashFilterCategory !== 'TODOS' && item.categoria !== state.dashFilterCategory) return false;
            const st = UI.normalizeStatus(item.status);
            if (state.dashFilterStatus !== 'todos' && st !== state.dashFilterStatus) return false;
            if (state.dashSearch) {
                const hay = `${item.id} ${item.modelo} ${item.colaboradorAtual} ${item.setor} ${item.observacao} ${getCategoryLabel(item.categoria)}`.toLowerCase();
                if (!hay.includes(state.dashSearch)) return false;
            }
            return true;
        });

        if (countEl) countEl.textContent = `${filtered.length} de ${all.length}`;

        if (filtered.length === 0) {
            const emptyHtml = `<div class="empty-state"><p>Nenhum equipamento encontrado com os filtros atuais.</p></div>`;
            if (tbody) tbody.innerHTML = `<tr><td colspan="9">${emptyHtml}</td></tr>`;
            if (mobileList) mobileList.innerHTML = emptyHtml;
            return;
        }

        if (tbody) {
            tbody.innerHTML = filtered.map(item => {
                const st = UI.normalizeStatus(item.status);
                const meta = UI.getStatusMeta(st);
                const isBat = item.categoria === 'BATERIA';
                const catBadge = `<span class="cat-badge ${isBat ? 'bateria' : 'radio'}">${isBat ? 'Bateria' : 'Rádio'}</span>`;
                const actionsHtml = buildEquipActions(item, st);

                return `
                    <tr>
                        <td><span class="mono-id">${UI.escHtml(item.id)}</span></td>
                        <td>${catBadge}</td>
                        <td>${UI.escHtml(item.modelo)}</td>
                        <td><span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span></td>
                        <td>${item.colaboradorAtual ? `<strong>${UI.escHtml(item.colaboradorAtual)}</strong>` : '<span class="muted">—</span>'}</td>
                        <td>${item.setor ? `<span class="muted">${UI.escHtml(item.setor)}</span>` : '<span class="muted">—</span>'}</td>
                        <td><span class="mono-date">${UI.formatDateTime(item.ultimaAtualizacao)}</span></td>
                        <td><span class="obs-cell" title="${UI.escHtml(item.observacao)}">${UI.escHtml(item.observacao) || '<span class="muted">—</span>'}</span></td>
                        <td class="actions-cell">${actionsHtml}</td>
                    </tr>
                `;
            }).join('');
        }

        if (mobileList) {
            mobileList.innerHTML = filtered.map(item => {
                const st = UI.normalizeStatus(item.status);
                const meta = UI.getStatusMeta(st);
                const isBat = item.categoria === 'BATERIA';
                const catBadge = `<span class="cat-badge ${isBat ? 'bateria' : 'radio'}">${isBat ? 'Bateria' : 'Rádio'}</span>`;
                const actionsHtml = buildEquipActions(item, st);

                return `
                    <article class="mobile-item-card">
                        <div class="mobile-card-top">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span class="mono-id">${UI.escHtml(item.id)}</span>
                                ${catBadge}
                                <span class="mobile-model">${UI.escHtml(item.modelo)}</span>
                            </div>
                            <span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span>
                        </div>
                        <div class="mobile-card-meta">
                            ${item.colaboradorAtual ? `<div><strong>Colaborador:</strong> ${UI.escHtml(item.colaboradorAtual)} (${UI.escHtml(item.setor || '—')})</div>` : ''}
                            <div><strong>Atualizado:</strong> <span class="mono-date">${UI.formatDateTime(item.ultimaAtualizacao)}</span></div>
                            ${item.observacao ? `<div><strong>Obs:</strong> ${UI.escHtml(item.observacao)}</div>` : ''}
                        </div>
                        <div class="mobile-card-actions">${actionsHtml}</div>
                    </article>
                `;
            }).join('');
        }
    }

    function buildEquipActions(item, st) {
        const safeId = UI.escHtml(item.id);
        const cat = item.categoria || 'RADIO';
        if (st === 'manutencao') {
            return `<button class="btn-action btn-action-success" onclick="RadioCtrl.openManutModal('${safeId}', 'Disponivel', '${cat}')">Liberar</button>`;
        }
        if (st === 'em uso') {
            return `
                <button class="btn-action btn-action-primary" onclick="RadioCtrl.quickReturn('${safeId}')" title="Preencher devolução rápida">Devolver</button>
                <span class="btn-action-locked" title="Devolva o item antes de enviar para manutenção">Em uso</span>
            `;
        }
        return `<button class="btn-action btn-action-warning" onclick="RadioCtrl.openManutModal('${safeId}', 'Manutencao', '${cat}')">Manutenção</button>`;
    }

    function quickReturn(equipId) {
        const equip = findEquipmentById(equipId);
        if (!equip) return;
        const inputRadio = document.getElementById('inputRadio');
        const inputColab = document.getElementById('inputColaborador');
        if (inputRadio) inputRadio.value = equip.id;
        if (inputColab && equip.colaboradorAtual) inputColab.value = equip.colaboradorAtual;
        handleEquipPreview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('inputObservacao')?.focus();
    }

    // ============================================================
    //  BIPAR: PREVIEW INTELIGENTE & AUTOCOMPLETE
    // ============================================================
    function handleEquipPreview() {
        const val = (document.getElementById('inputRadio')?.value || '').trim();
        const hint = document.getElementById('radioPreviewHint');
        const btn = document.getElementById('btnRegistrar');
        const btnLabel = document.getElementById('btnRegistrarLabel');
        const inputColab = document.getElementById('inputColaborador');

        if (!hint || !btn || !btnLabel) return;

        if (!val) {
            hint.innerHTML = '';
            hint.className = 'step-hint';
            btn.className = 'btn-primary btn-bipar';
            btnLabel.textContent = 'Confirmar Movimentação';
            return;
        }

        const equip = findEquipmentById(val);
        if (!equip) {
            hint.innerHTML = 'Equipamento não encontrado no cadastro';
            hint.className = 'step-hint hint-error';
            btn.className = 'btn-primary btn-bipar';
            btnLabel.textContent = 'Confirmar Movimentação';
            return;
        }

        const catLabel = getCategoryLabel(equip.categoria);
        const st = UI.normalizeStatus(equip.status);

        if (st === 'disponivel') {
            hint.innerHTML = `${catLabel} disponível (${UI.escHtml(equip.modelo)}) · Ação: <strong>Retirada</strong>`;
            hint.className = 'step-hint hint-success';
            btn.className = 'btn-primary btn-bipar mode-retirada';
            btnLabel.textContent = 'Confirmar Retirada';
        } else if (st === 'em uso') {
            hint.innerHTML = `${catLabel} em uso por <strong>${UI.escHtml(equip.colaboradorAtual || '—')}</strong> · Ação: <strong>Devolução</strong>`;
            hint.className = 'step-hint hint-info';
            btn.className = 'btn-primary btn-bipar mode-devolucao';
            btnLabel.textContent = 'Confirmar Devolução';
            if (inputColab && !inputColab.value.trim() && equip.colaboradorAtual) {
                inputColab.value = equip.colaboradorAtual;
            }
        } else {
            hint.innerHTML = `${catLabel} em Manutenção — libere antes de movimentar`;
            hint.className = 'step-hint hint-error';
            btn.className = 'btn-primary btn-bipar';
            btnLabel.textContent = 'Item em Manutenção';
        }
    }

    function renderColabAutocomplete(query) {
        const list = document.getElementById('colabAutocomplete');
        if (!list) return;

        const q = (query || '').trim().toLowerCase();
        const matches = state.colaboradores
            .filter(c => !q || c.nome.toLowerCase().includes(q) || (c.setor || '').toLowerCase().includes(q))
            .slice(0, 7);

        if (matches.length === 0) {
            list.classList.remove('open');
            return;
        }

        list.innerHTML = matches.map(c => `
            <button type="button" class="autocomplete-item" onclick="RadioCtrl.selectColaborador('${UI.escHtml(c.nome)}')">
                <span class="ac-name">${UI.escHtml(c.nome)}</span>
                <span class="ac-role">${UI.escHtml(c.setor)}</span>
            </button>
        `).join('');
        list.classList.add('open');
    }

    function selectColaborador(nome) {
        const input = document.getElementById('inputColaborador');
        if (input) input.value = nome;
        hideColabAutocomplete();
        document.getElementById('inputObservacao')?.focus();
    }

    function hideColabAutocomplete() {
        document.getElementById('colabAutocomplete')?.classList.remove('open');
    }

    async function registrarMovimentacao() {
        const radioInput = document.getElementById('inputRadio');
        const colabInput = document.getElementById('inputColaborador');
        const obsInput = document.getElementById('inputObservacao');
        const feedbackEl = document.getElementById('feedbackBipar');
        const btn = document.getElementById('btnRegistrar');
        const btnLabel = document.getElementById('btnRegistrarLabel');

        const equipId = (radioInput?.value || '').trim();
        const colaborador = (colabInput?.value || '').trim();
        const observacao = (obsInput?.value || '').trim();

        UI.clearBannerFeedback(feedbackEl);

        if (!equipId || !colaborador) {
            UI.playBeep('error');
            UI.showBannerFeedback(feedbackEl, 'Informe o ID do Equipamento e o Colaborador para registrar.', 'error');
            if (!equipId) radioInput?.focus();
            else colabInput?.focus();
            return;
        }

        const equip = findEquipmentById(equipId);
        const categoria = equip ? equip.categoria : (equipId.toUpperCase().startsWith('BAT') ? 'BATERIA' : 'RADIO');

        btn.disabled = true;
        btnLabel.textContent = 'Processando...';

        try {
            const res = await API.request({
                method: 'POST',
                data: {
                    action: 'registrarMovimentacao',
                    radioId: equipId,
                    colaborador,
                    observacao,
                    categoria
                }
            });

            if (res && res.success) {
                const isRet = res.tipo === 'retirada';
                const catText = getCategoryLabel(res.categoria || categoria);
                const msg = isRet
                    ? `Retirada registrada: ${catText} ${equipId} com ${colaborador}`
                    : `Devolução registrada: ${catText} ${equipId} por ${colaborador}`;

                UI.playBeep('success');
                UI.showBannerFeedback(feedbackEl, msg, 'success');
                UI.showToast(msg, 'success');

                if (radioInput) radioInput.value = '';
                if (colabInput) colabInput.value = '';
                if (obsInput) obsInput.value = '';
                handleEquipPreview();
                await loadDashboardData(true);
            } else {
                const errMsg = res?.message || 'Não foi possível registrar a movimentação.';
                UI.playBeep('error');
                UI.showBannerFeedback(feedbackEl, errMsg, 'error');
                UI.showToast(errMsg, 'error');
            }
        } catch (err) {
            UI.playBeep('error');
            UI.showBannerFeedback(feedbackEl, `Erro de conexão: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            handleEquipPreview();
        }
    }

    // ============================================================
    //  MODAL DE MANUTENÇÃO (Senha + Select Padronizado + Detalhes)
    // ============================================================
    function openManutModal(equipId, novoStatus, categoria = 'RADIO') {
        if (novoStatus === 'Manutencao') {
            const item = findEquipmentById(equipId);
            if (item && UI.normalizeStatus(item.status) === 'em uso') {
                UI.showToast('Devolva o equipamento antes de enviá-lo para manutenção.', 'warning');
                return;
            }
        }

        state.pendingManut = { equipId, novoStatus, categoria };

        const title = document.getElementById('modalManutTitulo');
        const desc = document.getElementById('modalManutDesc');
        const senha = document.getElementById('inputSenhaManutencao');
        const selectMotivo = document.getElementById('selectMotivoManutencao');
        const groupMotivo = document.getElementById('groupSelectMotivo');
        const detalhes = document.getElementById('inputDetalhesManutencao');
        const fb = document.getElementById('feedbackManut');

        const isSendingToManut = novoStatus === 'Manutencao';

        if (title) {
            title.textContent = isSendingToManut
                ? `Enviar ${equipId} para Manutenção`
                : `Liberar ${equipId} da Manutenção`;
        }
        if (desc) {
            desc.textContent = isSendingToManut
                ? 'Informe a senha de administrador e selecione o defeito técnico identificado.'
                : 'Informe a senha de administrador para liberar o equipamento como disponível.';
        }
        if (groupMotivo) groupMotivo.style.display = isSendingToManut ? 'flex' : 'none';
        if (senha) senha.value = '';
        if (selectMotivo) selectMotivo.value = '';
        if (detalhes) detalhes.value = '';
        if (fb) UI.clearBannerFeedback(fb);

        UI.openModal('modalManutencao');
        setTimeout(() => senha?.focus(), 80);
    }

    async function confirmManutencao() {
        const senha = document.getElementById('inputSenhaManutencao')?.value || '';
        const motivoSelect = document.getElementById('selectMotivoManutencao')?.value || '';
        const detalhes = (document.getElementById('inputDetalhesManutencao')?.value || '').trim();
        const fb = document.getElementById('feedbackManut');

        UI.clearBannerFeedback(fb);

        if (senha !== ADMIN_PASSWORD) {
            UI.playBeep('error');
            UI.showBannerFeedback(fb, 'Senha de administrador incorreta.', 'error');
            return;
        }

        const { equipId, novoStatus, categoria } = state.pendingManut || {};
        if (!equipId) return;

        let justificativaFinal = '';
        if (novoStatus === 'Manutencao') {
            if (!motivoSelect) {
                UI.playBeep('error');
                UI.showBannerFeedback(fb, 'Selecione um motivo técnico da lista.', 'error');
                document.getElementById('selectMotivoManutencao')?.focus();
                return;
            }
            justificativaFinal = detalhes ? `${motivoSelect} — ${detalhes}` : motivoSelect;
        } else {
            justificativaFinal = detalhes || 'Equipamento liberado da manutenção';
        }

        try {
            const res = await API.request({
                method: 'POST',
                data: {
                    action: 'alterarStatus',
                    radioId: equipId,
                    novoStatus,
                    justificativa: justificativaFinal,
                    categoria
                }
            });

            if (res && res.success) {
                UI.closeModal('modalManutencao');
                UI.playBeep('success');
                UI.showToast(`${equipId} atualizado para ${novoStatus === 'Manutencao' ? 'Manutenção' : 'Disponível'}.`, 'success');
                await loadDashboardData(false);
                if (state.currentScreen === 'cadastro' && isAdminAuthenticated()) {
                    await loadCadastroData();
                }
            } else {
                UI.showBannerFeedback(fb, res?.message || 'Erro ao alterar status.', 'error');
            }
        } catch (err) {
            UI.showBannerFeedback(fb, `Erro: ${err.message}`, 'error');
        }
    }

    // ============================================================
    //  AUTENTICAÇÃO SEM PERSISTÊNCIA & AUTO-BLOQUEIO (2 MIN)
    // ============================================================
    function isAdminAuthenticated() {
        return state.adminAuthorized === true;
    }

    function clearRestrictedDom() {
        ['historicoContent', 'cadastroContent'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        [
            'tbodyHistorico', 'mobileHistoricoList',
            'tbodyRadiosCadastro', 'mobileRadiosCadastro',
            'tbodyBateriasCadastro', 'mobileBateriasCadastro',
            'tbodyColabs', 'mobileColabsList'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
        ['inputAuthGateSenha', 'inputAuthGateHistSenha'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    function revokeAdminSession() {
        state.adminAuthorized = false;
        clearInactivityTimer();
        clearRestrictedDom();
    }

    function clearInactivityTimer() {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    }

    function resetInactivityTimer() {
        clearInactivityTimer();
        if (!isAdminAuthenticated()) return;
        if (state.currentScreen !== 'historico' && state.currentScreen !== 'cadastro') return;

        inactivityTimer = setTimeout(() => {
            if (!isAdminAuthenticated()) return;
            document.querySelectorAll('.modal-overlay.open').forEach(m => UI.closeModal(m.id));
            revokeAdminSession();
            UI.showToast('Sessão administrativa bloqueada por inatividade (2 min).', 'warning');
            showScreen('dashboard');
        }, INACTIVITY_TIMEOUT_MS);
    }

    function handleUserActivity() {
        if (isAdminAuthenticated() && (state.currentScreen === 'historico' || state.currentScreen === 'cadastro')) {
            resetInactivityTimer();
        }
    }

    function renderAuthGate(screen) {
        const isAuth = isAdminAuthenticated();
        if (screen === 'cadastro') {
            const gate = document.getElementById('cadastroAuthGate');
            const content = document.getElementById('cadastroContent');
            const fb = document.getElementById('feedbackAuthGate');
            const input = document.getElementById('inputAuthGateSenha');
            if (gate) gate.style.display = isAuth ? 'none' : 'flex';
            if (content) content.style.display = isAuth ? 'block' : 'none';
            if (isAuth) {
                resetInactivityTimer();
                loadCadastroData();
            } else {
                if (fb) UI.clearBannerFeedback(fb);
                if (input) { input.value = ''; setTimeout(() => input.focus(), 80); }
            }
        } else if (screen === 'historico') {
            const gate = document.getElementById('historicoAuthGate');
            const content = document.getElementById('historicoContent');
            const fb = document.getElementById('feedbackAuthGateHist');
            const input = document.getElementById('inputAuthGateHistSenha');
            if (gate) gate.style.display = isAuth ? 'none' : 'flex';
            if (content) content.style.display = isAuth ? 'block' : 'none';
            if (isAuth) {
                resetInactivityTimer();
                loadHistorico();
            } else {
                if (fb) UI.clearBannerFeedback(fb);
                if (input) { input.value = ''; setTimeout(() => input.focus(), 80); }
            }
        }
    }

    function authenticateAdmin(originScreen) {
        const isHist = originScreen === 'historico';
        const input = document.getElementById(isHist ? 'inputAuthGateHistSenha' : 'inputAuthGateSenha');
        const fb = document.getElementById(isHist ? 'feedbackAuthGateHist' : 'feedbackAuthGate');
        if (!input) return;

        if (input.value !== ADMIN_PASSWORD) {
            UI.playBeep('error');
            UI.showBannerFeedback(fb, 'Senha incorreta. Tente novamente.', 'error');
            input.select();
            return;
        }

        input.value = '';
        state.adminAuthorized = true;
        UI.playBeep('success');
        UI.showToast('Acesso administrativo liberado.', 'success');
        renderAuthGate(originScreen);
    }

    function lockAdminAccess() {
        revokeAdminSession();
        UI.showToast('Acesso administrativo bloqueado.', 'info');
        renderAuthGate(state.currentScreen);
    }

    // ============================================================
    //  TELA 3: GERENCIAMENTO DE CADASTRO (Rádios | Baterias | Colaboradores)
    // ============================================================
    function switchCadastroTab(tab) {
        state.cadastroTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === tab);
        });
        document.querySelectorAll('.tab-panel').forEach(p => {
            p.classList.toggle('active', p.id === `tab-${tab}`);
        });
    }

    async function loadCadastroData() {
        try {
            const [radiosRes, bateriasRes, colabsRes] = await Promise.all([
                API.request({ method: 'GET', data: { action: 'getRadios' } }),
                API.request({ method: 'GET', data: { action: 'getBaterias' } }).catch(() => ({ baterias: [] })),
                API.request({ method: 'GET', data: { action: 'getColaboradores' } })
            ]);
            state.radios = radiosRes?.radios || [];
            state.baterias = bateriasRes?.baterias || [];
            state.colaboradores = colabsRes?.colaboradores || [];

            document.getElementById('countRadiosTab').textContent = state.radios.length;
            document.getElementById('countBateriasTab').textContent = state.baterias.length;
            document.getElementById('countColabsTab').textContent = state.colaboradores.length;

            renderCadastroRadios();
            renderCadastroBaterias();
            renderCadastroColabs();
        } catch (err) {
            UI.showToast(`Erro ao carregar cadastros: ${err.message}`, 'error');
        }
    }

    function filterCadastroRadios(val) {
        state.cadastroSearchRadios = (val || '').trim().toLowerCase();
        renderCadastroRadios();
    }

    function filterCadastroBaterias(val) {
        state.cadastroSearchBaterias = (val || '').trim().toLowerCase();
        renderCadastroBaterias();
    }

    function filterCadastroColabs(val) {
        state.cadastroSearchColabs = (val || '').trim().toLowerCase();
        renderCadastroColabs();
    }

    function renderEquipCadastroList({ items, search, tbodyId, mobileId, categoria, editFnName }) {
        const tbody = document.getElementById(tbodyId);
        const mobileList = document.getElementById(mobileId);
        const list = items.filter(item => !search || `${item.id} ${item.modelo}`.toLowerCase().includes(search));

        if (list.length === 0) {
            const empty = `<div class="empty-state"><p>Nenhum registro encontrado.</p></div>`;
            if (tbody) tbody.innerHTML = `<tr><td colspan="4">${empty}</td></tr>`;
            if (mobileList) mobileList.innerHTML = empty;
            return;
        }

        const delType = categoria === 'BATERIA' ? 'bateria' : 'radio';
        const delLabel = categoria === 'BATERIA' ? 'bateria' : 'rádio';

        if (tbody) {
            tbody.innerHTML = list.map(r => {
                const st = UI.normalizeStatus(r.status);
                const meta = UI.getStatusMeta(st);
                const safeId = UI.escHtml(r.id);
                const manutBtn = st === 'manutencao'
                    ? `<button class="btn-action btn-action-success" onclick="RadioCtrl.openManutModal('${safeId}', 'Disponivel', '${categoria}')">Liberar</button>`
                    : `<button class="btn-action btn-action-warning" onclick="RadioCtrl.openManutModal('${safeId}', 'Manutencao', '${categoria}')">Manutenção</button>`;

                return `
                    <tr>
                        <td><span class="mono-id">${safeId}</span></td>
                        <td>${UI.escHtml(r.modelo)}</td>
                        <td><span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span></td>
                        <td class="actions-cell">
                            <button class="btn-action btn-action-neutral" onclick="RadioCtrl.${editFnName}('${safeId}')">Editar</button>
                            ${manutBtn}
                            <button class="btn-action btn-action-danger" onclick="RadioCtrl.askDelete('${delType}', '${safeId}', '${delLabel} ${safeId}')">Excluir</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (mobileList) {
            mobileList.innerHTML = list.map(r => {
                const st = UI.normalizeStatus(r.status);
                const meta = UI.getStatusMeta(st);
                const safeId = UI.escHtml(r.id);
                return `
                    <article class="mobile-item-card">
                        <div class="mobile-card-top">
                            <div>
                                <span class="mono-id">${safeId}</span>
                                <span class="mobile-model">${UI.escHtml(r.modelo)}</span>
                            </div>
                            <span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span>
                        </div>
                        <div class="mobile-card-actions">
                            <button class="btn-action btn-action-neutral" onclick="RadioCtrl.${editFnName}('${safeId}')">Editar</button>
                            <button class="btn-action btn-action-danger" onclick="RadioCtrl.askDelete('${delType}', '${safeId}', '${delLabel} ${safeId}')">Excluir</button>
                        </div>
                    </article>
                `;
            }).join('');
        }
    }

    function renderCadastroRadios() {
        renderEquipCadastroList({
            items: state.radios,
            search: state.cadastroSearchRadios,
            tbodyId: 'tbodyRadiosCadastro',
            mobileId: 'mobileRadiosCadastro',
            categoria: 'RADIO',
            editFnName: 'openEditRadio'
        });
    }

    function renderCadastroBaterias() {
        renderEquipCadastroList({
            items: state.baterias,
            search: state.cadastroSearchBaterias,
            tbodyId: 'tbodyBateriasCadastro',
            mobileId: 'mobileBateriasCadastro',
            categoria: 'BATERIA',
            editFnName: 'openEditBateria'
        });
    }

    function renderCadastroColabs() {
        const tbody = document.getElementById('tbodyColabs');
        const mobileList = document.getElementById('mobileColabsList');
        const list = state.colaboradores.filter(c => {
            if (!state.cadastroSearchColabs) return true;
            return `${c.nome} ${c.setor}`.toLowerCase().includes(state.cadastroSearchColabs);
        });

        if (list.length === 0) {
            const empty = `<div class="empty-state"><p>Nenhum colaborador encontrado.</p></div>`;
            if (tbody) tbody.innerHTML = `<tr><td colspan="3">${empty}</td></tr>`;
            if (mobileList) mobileList.innerHTML = empty;
            return;
        }

        if (tbody) {
            tbody.innerHTML = list.map(c => {
                const safeNome = UI.escHtml(c.nome);
                return `
                    <tr>
                        <td><strong>${safeNome}</strong></td>
                        <td><span class="muted">${UI.escHtml(c.setor)}</span></td>
                        <td class="actions-cell">
                            <button class="btn-action btn-action-neutral" onclick="RadioCtrl.openEditColab('${safeNome}')">Editar</button>
                            <button class="btn-action btn-action-danger" onclick="RadioCtrl.askDelete('colab', '${safeNome}', 'colaborador ${safeNome}')">Excluir</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (mobileList) {
            mobileList.innerHTML = list.map(c => {
                const safeNome = UI.escHtml(c.nome);
                return `
                    <article class="mobile-item-card">
                        <div class="mobile-card-top">
                            <div>
                                <strong>${safeNome}</strong>
                                <div class="muted" style="font-size:0.82rem;">${UI.escHtml(c.setor)}</div>
                            </div>
                        </div>
                        <div class="mobile-card-actions">
                            <button class="btn-action btn-action-neutral" onclick="RadioCtrl.openEditColab('${safeNome}')">Editar</button>
                            <button class="btn-action btn-action-danger" onclick="RadioCtrl.askDelete('colab', '${safeNome}', 'colaborador ${safeNome}')">Excluir</button>
                        </div>
                    </article>
                `;
            }).join('');
        }
    }

    async function cadastrarRadio() {
        const idEl = document.getElementById('radioId');
        const modEl = document.getElementById('radioModelo');
        const id = (idEl?.value || '').trim();
        const modelo = (modEl?.value || '').trim();
        if (!id || !modelo) return UI.showToast('Preencha o ID e o Modelo do rádio.', 'error');

        try {
            const res = await API.request({ method: 'POST', data: { action: 'cadastrarRadio', id, modelo } });
            if (res && res.success) {
                UI.showToast(`Rádio ${id} cadastrado com sucesso!`, 'success');
                idEl.value = '';
                modEl.value = '';
                await loadCadastroData();
            } else {
                UI.showToast(res?.message || 'Erro ao cadastrar rádio.', 'error');
            }
        } catch (err) {
            UI.showToast(`Erro: ${err.message}`, 'error');
        }
    }

    async function cadastrarBateria() {
        const idEl = document.getElementById('bateriaId');
        const modEl = document.getElementById('bateriaModelo');
        const id = (idEl?.value || '').trim();
        const modelo = (modEl?.value || '').trim();
        if (!id || !modelo) return UI.showToast('Preencha o ID e o Modelo/Capacidade da bateria.', 'error');

        try {
            const res = await API.request({ method: 'POST', data: { action: 'cadastrarBateria', id, modelo } });
            if (res && res.success) {
                UI.showToast(`Bateria ${id} cadastrada com sucesso!`, 'success');
                idEl.value = '';
                modEl.value = '';
                await loadCadastroData();
            } else {
                UI.showToast(res?.message || 'Erro ao cadastrar bateria.', 'error');
            }
        } catch (err) {
            UI.showToast(`Erro: ${err.message}`, 'error');
        }
    }

    async function cadastrarColaborador() {
        const nomeEl = document.getElementById('colabNome');
        const setorEl = document.getElementById('colabSetor');
        const nome = (nomeEl?.value || '').trim();
        const setor = (setorEl?.value || '').trim();
        if (!nome || !setor) return UI.showToast('Preencha o Nome Completo e a Função / Setor.', 'error');

        try {
            const res = await API.request({ method: 'POST', data: { action: 'cadastrarColaborador', nome, setor } });
            if (res && res.success) {
                UI.showToast(`Colaborador ${nome} cadastrado!`, 'success');
                nomeEl.value = '';
                setorEl.value = '';
                await loadCadastroData();
            } else {
                UI.showToast(res?.message || 'Erro ao cadastrar colaborador.', 'error');
            }
        } catch (err) {
            UI.showToast(`Erro: ${err.message}`, 'error');
        }
    }

    // --- Edição ---
    function openEditRadio(id) {
        const r = state.radios.find(item => item.id === id);
        if (!r) return;
        state.pendingEdit = { type: 'radio', originalKey: r.id };
        document.getElementById('modalEditTitle').textContent = `Editar Rádio ${r.id}`;
        document.getElementById('editField1Label').textContent = 'ID do Rádio';
        document.getElementById('editField1').value = r.id;
        document.getElementById('editField2Label').textContent = 'Modelo';
        document.getElementById('editField2').value = r.modelo;
        UI.openModal('modalEdit');
    }

    function openEditBateria(id) {
        const b = state.baterias.find(item => item.id === id);
        if (!b) return;
        state.pendingEdit = { type: 'bateria', originalKey: b.id };
        document.getElementById('modalEditTitle').textContent = `Editar Bateria ${b.id}`;
        document.getElementById('editField1Label').textContent = 'ID da Bateria';
        document.getElementById('editField1').value = b.id;
        document.getElementById('editField2Label').textContent = 'Modelo / Capacidade';
        document.getElementById('editField2').value = b.modelo;
        UI.openModal('modalEdit');
    }

    function openEditColab(nome) {
        const c = state.colaboradores.find(item => item.nome === nome);
        if (!c) return;
        state.pendingEdit = { type: 'colab', originalKey: c.nome };
        document.getElementById('modalEditTitle').textContent = 'Editar Colaborador';
        document.getElementById('editField1Label').textContent = 'Nome Completo';
        document.getElementById('editField1').value = c.nome;
        document.getElementById('editField2Label').textContent = 'Função / Setor';
        document.getElementById('editField2').value = c.setor;
        UI.openModal('modalEdit');
    }

    async function saveEdit() {
        const v1 = (document.getElementById('editField1')?.value || '').trim();
        const v2 = (document.getElementById('editField2')?.value || '').trim();
        if (!v1 || !v2) return UI.showToast('Preencha todos os campos.', 'error');

        const { type, originalKey } = state.pendingEdit || {};
        if (!type) return;

        let payload;
        if (type === 'radio') payload = { action: 'editarRadio', originalId: originalKey, id: v1, modelo: v2 };
        else if (type === 'bateria') payload = { action: 'editarBateria', originalId: originalKey, id: v1, modelo: v2 };
        else payload = { action: 'editarColaborador', originalNome: originalKey, nome: v1, setor: v2 };

        try {
            const res = await API.request({ method: 'POST', data: payload });
            if (res && res.success) {
                UI.closeModal('modalEdit');
                UI.showToast('Registro atualizado com sucesso!', 'success');
                await loadCadastroData();
            } else {
                UI.showToast(res?.message || 'Erro ao atualizar.', 'error');
            }
        } catch (err) {
            UI.showToast(`Erro: ${err.message}`, 'error');
        }
    }

    // --- Exclusão ---
    function askDelete(type, key, label) {
        state.pendingDelete = { type, key };
        document.getElementById('confirmDeleteText').textContent = `Tem certeza que deseja excluir ${label}? Esta ação não pode ser desfeita.`;
        UI.openModal('modalConfirmDelete');
    }

    async function confirmDelete() {
        const { type, key } = state.pendingDelete || {};
        if (!type) return;

        let payload;
        if (type === 'radio') payload = { action: 'excluirRadio', id: key };
        else if (type === 'bateria') payload = { action: 'excluirBateria', id: key };
        else payload = { action: 'excluirColaborador', nome: key };

        try {
            const res = await API.request({ method: 'POST', data: payload });
            if (res && res.success) {
                UI.closeModal('modalConfirmDelete');
                UI.showToast('Registro excluído.', 'info');
                await loadCadastroData();
            } else {
                UI.showToast(res?.message || 'Erro ao excluir.', 'error');
            }
        } catch (err) {
            UI.showToast(`Erro: ${err.message}`, 'error');
        }
    }

    // ============================================================
    //  TELA 2: HISTÓRICO DE MOVIMENTAÇÕES (PROTEGIDO + CSV + PDF)
    // ============================================================
    async function loadHistorico() {
        try {
            const res = await API.request({ method: 'GET', data: { action: 'getMovimentacoes' } });
            state.movimentacoes = (res?.movimentacoes || []).map(m => ({
                ...m,
                categoria: m.categoria || (String(m.radioId || '').toUpperCase().startsWith('BAT') ? 'BATERIA' : 'RADIO')
            }));
            state.histPage = 1;
            renderHistorico();
        } catch (err) {
            UI.showToast(`Erro ao carregar histórico: ${err.message}`, 'error');
        }
    }

    function getFilteredHistorico() {
        const dtInicio = parseLocalDate(state.histDataInicio, false);
        const dtFim = parseLocalDate(state.histDataFim, true);

        const ordered = [...state.movimentacoes].sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora));

        return ordered.filter(m => {
            if (dtInicio && new Date(m.dataHora) < dtInicio) return false;
            if (dtFim && new Date(m.dataHora) > dtFim) return false;

            if (state.histCategoria !== 'TODOS' && m.categoria !== state.histCategoria) return false;

            if (state.histTipo !== 'todos') {
                const t = String(m.tipo || '').toLowerCase();
                if (state.histTipo === 'retirada' && !t.includes('retir')) return false;
                if (state.histTipo === 'devolucao' && (!t.includes('devol') && !t.includes('retorno'))) return false;
                if (state.histTipo === 'manutencao' && !t.includes('manut')) return false;
            }

            if (state.histSearch) {
                const hay = `${m.radioId} ${m.colaborador} ${m.setor} ${m.observacao} ${getCategoryLabel(m.categoria)}`.toLowerCase();
                if (!hay.includes(state.histSearch)) return false;
            }

            return true;
        });
    }

    function applyHistFilters() {
        state.histSearch = (document.getElementById('histSearch')?.value || '').trim().toLowerCase();
        state.histCategoria = document.getElementById('histCategoria')?.value || 'TODOS';
        state.histTipo = document.getElementById('histTipo')?.value || 'todos';
        state.histDataInicio = document.getElementById('filterDataInicio')?.value || '';
        state.histDataFim = document.getElementById('filterDataFim')?.value || '';
        state.histPage = 1;
        renderHistorico();
    }

    function setHistDateShortcut(preset) {
        const today = new Date();
        const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        if (preset === 'today') {
            const iso = toIso(today);
            document.getElementById('filterDataInicio').value = iso;
            document.getElementById('filterDataFim').value = iso;
        } else if (preset === '7days') {
            const start = new Date(today);
            start.setDate(start.getDate() - 6);
            document.getElementById('filterDataInicio').value = toIso(start);
            document.getElementById('filterDataFim').value = toIso(today);
        } else {
            document.getElementById('histSearch').value = '';
            document.getElementById('histCategoria').value = 'TODOS';
            document.getElementById('histTipo').value = 'todos';
            document.getElementById('filterDataInicio').value = '';
            document.getElementById('filterDataFim').value = '';
        }
        applyHistFilters();
    }

    function renderHistorico() {
        const filtered = getFilteredHistorico();
        const total = filtered.length;
        const retiradas = filtered.filter(m => String(m.tipo || '').toLowerCase().includes('retir')).length;
        const devManut = total - retiradas;

        document.getElementById('histStatTotal').textContent = total;
        document.getElementById('histStatRetiradas').textContent = retiradas;
        document.getElementById('histStatOutros').textContent = devManut;

        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (state.histPage > totalPages) state.histPage = totalPages;

        const startIdx = (state.histPage - 1) * PAGE_SIZE;
        const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

        const tbody = document.getElementById('tbodyHistorico');
        const mobileList = document.getElementById('mobileHistoricoList');

        if (pageItems.length === 0) {
            const empty = `<div class="empty-state"><p>Nenhuma movimentação encontrada para os filtros selecionados.</p></div>`;
            if (tbody) tbody.innerHTML = `<tr><td colspan="8">${empty}</td></tr>`;
            if (mobileList) mobileList.innerHTML = empty;
        } else {
            if (tbody) {
                tbody.innerHTML = pageItems.map((m, i) => {
                    const num = total - (startIdx + i);
                    const meta = UI.getMovTipoMeta(m.tipo);
                    const isBat = m.categoria === 'BATERIA';
                    const catBadge = `<span class="cat-badge ${isBat ? 'bateria' : 'radio'}">${isBat ? 'Bateria' : 'Rádio'}</span>`;
                    return `
                        <tr>
                            <td><span class="mono-num muted">#${num}</span></td>
                            <td><span class="mono-date">${UI.formatDateTime(m.dataHora)}</span></td>
                            <td><span class="mono-id">${UI.escHtml(m.radioId)}</span></td>
                            <td>${catBadge}</td>
                            <td><strong>${UI.escHtml(m.colaborador)}</strong></td>
                            <td><span class="muted">${UI.escHtml(m.setor) || '—'}</span></td>
                            <td><span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span></td>
                            <td><span class="obs-cell">${UI.escHtml(m.observacao) || '<span class="muted">—</span>'}</span></td>
                        </tr>
                    `;
                }).join('');
            }

            if (mobileList) {
                mobileList.innerHTML = pageItems.map((m, i) => {
                    const num = total - (startIdx + i);
                    const meta = UI.getMovTipoMeta(m.tipo);
                    const isBat = m.categoria === 'BATERIA';
                    const catBadge = `<span class="cat-badge ${isBat ? 'bateria' : 'radio'}">${isBat ? 'Bateria' : 'Rádio'}</span>`;
                    return `
                        <article class="mobile-item-card">
                            <div class="mobile-card-top">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <span class="mono-num muted">#${num}</span>
                                    <span class="mono-id">${UI.escHtml(m.radioId)}</span>
                                    ${catBadge}
                                </div>
                                <span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span>
                            </div>
                            <div class="mobile-card-meta">
                                <div><strong>Colaborador:</strong> ${UI.escHtml(m.colaborador)} (${UI.escHtml(m.setor || '—')})</div>
                                <div><strong>Data/Hora:</strong> <span class="mono-date">${UI.formatDateTime(m.dataHora)}</span></div>
                                ${m.observacao ? `<div><strong>Obs:</strong> ${UI.escHtml(m.observacao)}</div>` : ''}
                            </div>
                        </article>
                    `;
                }).join('');
            }
        }

        renderPagination(totalPages, total);
    }

    function renderPagination(totalPages, totalItems) {
        const info = document.getElementById('histPageInfo');
        const prev = document.getElementById('btnHistPrev');
        const next = document.getElementById('btnHistNext');

        if (info) info.textContent = `Página ${state.histPage} de ${totalPages} (${totalItems} registros)`;
        if (prev) prev.disabled = state.histPage <= 1;
        if (next) next.disabled = state.histPage >= totalPages;
    }

    function changeHistPage(delta) {
        state.histPage = Math.max(1, state.histPage + delta);
        renderHistorico();
    }

    function exportHistoricoCSV() {
        const rows = getFilteredHistorico();
        if (rows.length === 0) return UI.showToast('Nenhum registro para exportar.', 'warning');

        const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        const headers = ['#', 'Data/Hora', 'ID Equipamento', 'Tipo Item', 'Colaborador', 'Função', 'Tipo Movimentação', 'Observação / Justificativa'];
        const lines = [
            headers.map(escapeCsv).join(';'),
            ...rows.map((m, idx) => [
                rows.length - idx,
                UI.formatDateTime(m.dataHora),
                m.radioId,
                getCategoryLabel(m.categoria),
                m.colaborador,
                m.setor || '',
                UI.getMovTipoMeta(m.tipo).label,
                m.observacao || ''
            ].map(escapeCsv).join(';'))
        ];

        const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `radioctrl-historico-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        UI.showToast(`CSV exportado com ${rows.length} registros.`, 'success');
    }

    function exportHistoricoPDF() {
        const rows = getFilteredHistorico();
        if (rows.length === 0) return UI.showToast('Nenhum registro para exportar.', 'warning');

        if (!global.jspdf || !global.jspdf.jsPDF) {
            return UI.showToast('Biblioteca jsPDF ainda não carregada. Verifique a conexão.', 'error');
        }

        const { jsPDF } = global.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        const total = rows.length;
        const retiradas = rows.filter(m => String(m.tipo || '').toLowerCase().includes('retir')).length;
        const devManut = total - retiradas;

        // Cabeçalho
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(15, 23, 42);
        doc.text('RádioCtrl — Relatório de Histórico de Movimentações', 14, 16);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 14, 22);

        const filtros = [];
        if (state.histCategoria !== 'TODOS') filtros.push(`Item: ${getCategoryLabel(state.histCategoria)}`);
        if (state.histTipo !== 'todos') filtros.push(`Movimentação: ${state.histTipo}`);
        if (state.histDataInicio || state.histDataFim) {
            filtros.push(`Período: ${state.histDataInicio || '...'} até ${state.histDataFim || '...'}`);
        }
        if (state.histSearch) filtros.push(`Busca: "${state.histSearch}"`);
        const filtroTexto = filtros.length > 0 ? filtros.join(' | ') : 'Todos os registros (sem filtros)';
        doc.text(`Filtros aplicados: ${filtroTexto}`, 14, 27);

        // Resumo numérico
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(14, 31, 269, 10, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(`Total de Registros: ${total}     |     Retiradas: ${retiradas}     |     Devoluções / Manutenções: ${devManut}`, 18, 37.5);

        const bodyRows = rows.map((m, idx) => [
            `#${rows.length - idx}`,
            UI.formatDateTime(m.dataHora),
            m.radioId || '—',
            getCategoryLabel(m.categoria),
            m.colaborador || '—',
            m.setor || '—',
            UI.getMovTipoMeta(m.tipo).label,
            m.observacao || '—'
        ]);

        doc.autoTable({
            startY: 45,
            head: [['#', 'Data/Hora', 'ID Equipamento', 'Tipo Item', 'Colaborador', 'Função', 'Tipo Movimentação', 'Observação / Justificativa']],
            body: bodyRows,
            styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 41, 59] },
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(
                    `2026 - Marlon Fernandes & Larissa Teixeira — Sistema Inteligente de Gestão de Rádios`,
                    14,
                    doc.internal.pageSize.getHeight() - 8
                );
                doc.text(
                    `Página ${data.pageNumber} de ${pageCount}`,
                    doc.internal.pageSize.getWidth() - 32,
                    doc.internal.pageSize.getHeight() - 8
                );
            }
        });

        doc.save(`radioctrl-historico-${new Date().toISOString().slice(0, 10)}.pdf`);
        UI.showToast(`PDF gerado com ${rows.length} registros.`, 'success');
    }

    function parseLocalDate(str, endOfDay) {
        if (!str) return null;
        const [y, m, d] = str.split('-').map(Number);
        if (!y || !m || !d) return null;
        const dt = new Date(y, m - 1, d);
        if (endOfDay) dt.setHours(23, 59, 59, 999);
        else dt.setHours(0, 0, 0, 0);
        return dt;
    }

    global.RadioCtrl = {
        showScreen,
        toggleTheme: UI.toggleTheme,
        toggleSidebar: UI.toggleSidebar,
        closeModal: UI.closeModal,
        loadDashboardData,
        filterDashboardByKpi,
        setDashboardCategoryFilter,
        setDashboardStatusFilter,
        onDashboardSearch,
        selectColaborador,
        registrarMovimentacao,
        quickReturn,
        openManutModal,
        confirmManutencao,
        authenticateAdmin,
        lockAdminAccess,
        switchCadastroTab,
        filterCadastroRadios,
        filterCadastroBaterias,
        filterCadastroColabs,
        cadastrarRadio,
        cadastrarBateria,
        cadastrarColaborador,
        openEditRadio,
        openEditBateria,
        openEditColab,
        saveEdit,
        askDelete,
        confirmDelete,
        applyHistFilters,
        setHistDateShortcut,
        changeHistPage,
        exportHistoricoCSV,
        exportHistoricoPDF
    };
})(window);
