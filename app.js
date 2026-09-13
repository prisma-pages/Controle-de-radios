/**
 * ============================================================
 *  GESTAO E CONTROLE DE RADIOS - SISTEMA INTELIGENTE
 *  app.js — Logica principal do Front-end
 *  Autor: Marlon Fernandes & Larissa Teixeira
 *  Ano: 2026
 * ============================================================
 */

// ============================================================
//  CONFIGURACAO DA API
//  Cole abaixo a URL do seu Google Apps Script Web App.
//  Exemplo: 'https://script.google.com/macros/s/SEU_ID/exec'
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbx4Wte11mTSMd0JL8wR-Ivj3ix75nIxNL8xPrUsZ8-A_OnnLQmjWEa5uzCCqELUwZPh/exec';

// ============================================================
//  ESTADO LOCAL (cache)
// ============================================================
let radiosData = [];
let colaboradoresData = [];
let movimentacoesData = [];

// ============================================================
//  INICIALIZACAO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadDashboardData();

  // Detecta Enter nos inputs de bipar
  document.getElementById('inputRadio').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') registrarMovimentacao();
  });

  document.getElementById('inputColaborador').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('inputRadio').focus();
  });
});

// ============================================================
//  NAVEGACAO SPA
// ============================================================
function showScreen(screenName) {
  // Remove active de todas as telas
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  // Remove active de todos os botoes nav
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Ativa a tela e botao selecionados
  const screen = document.getElementById('screen-' + screenName);
  const navBtn = document.getElementById('nav-' + screenName);

  if (screen) screen.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  // Carrega dados ao mudar de tela
  if (screenName === 'dashboard') {
    loadDashboardData();
  } else if (screenName === 'cadastro') {
    loadCadastroData();
  } else if (screenName === 'historico') {
    loadHistorico();
  }
}

// ============================================================
//  RELOGIO DIGITAL
// ============================================================
function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clockTime').textContent = `${hours}:${minutes}:${seconds}`;

  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const dayName = days[now.getDay()];
  document.getElementById('clockDate').textContent = `${dayName}, ${day}/${month}/${year}`;
}



// ============================================================
//  API — FUNCAO CENTRAL DE REQUISICAO
// ============================================================
async function apiRequest(params) {
  if (!API_URL) {
    showToast('Configure a URL da API primeiro! Clique no icone de Configuracoes.', 'error');
    return null;
  }

  try {
    let response;

    if (params.method === 'GET' || !params.method) {
      const queryString = new URLSearchParams(params.data).toString();
      const url = queryString ? `${API_URL}?${queryString}` : API_URL;
      response = await fetch(url, { method: 'GET' });
    } else {
      response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(params.data),
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Erro na API:', err);
    showToast(`Erro de conexao: ${err.message}`, 'error');
    return null;
  }
}

// ============================================================
//  DASHBOARD — Carregar dados
// ============================================================
async function loadDashboardData() {
  setTableLoading('tbodyRadios', 7);

  const data = await apiRequest({ method: 'GET', data: { action: 'getRadios' } });

  if (!data) {
    setTableError('tbodyRadios', 7, 'Nao foi possivel carregar. Verifique a URL da API.');
    return;
  }

  radiosData = data.radios || [];
  renderRadiosTable(radiosData);
  updateKPIs(radiosData);
}

function updateKPIs(radios) {
  const total = radios.length;
  const disponiveis = radios.filter(r => normalizeStatus(r.status) === 'disponivel').length;
  const emUso = radios.filter(r => normalizeStatus(r.status) === 'em uso').length;
  const manutencao = radios.filter(r => normalizeStatus(r.status) === 'manutencao').length;

  animateCounter('kpiTotal', total);
  animateCounter('kpiDisponivel', disponiveis);
  animateCounter('kpiEmUso', emUso);
  animateCounter('kpiManutencao', manutencao);
}

function animateCounter(elementId, targetValue) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (targetValue - start) * eased);
    el.textContent = current;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function renderRadiosTable(radios) {
  const tbody = document.getElementById('tbodyRadios');

  if (!radios || radios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">Nenhum radio cadastrado ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = radios.map(r => {
    const statusNorm = normalizeStatus(r.status);
    const badgeClass = statusBadgeClass(statusNorm);
    const statusLabel = statusDisplayLabel(statusNorm);
    const dot = statusDot(statusNorm);

    return `
      <tr>
        <td><strong>${escHtml(r.id)}</strong></td>
        <td>${escHtml(r.modelo)}</td>
        <td><span class="status-badge ${badgeClass}">${dot} ${statusLabel}</span></td>
        <td>${escHtml(r.colaboradorAtual) || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${escHtml(r.setor) || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="color:var(--text-muted); font-size:0.78rem;">${formatDateTime(r.ultimaAtualizacao)}</td>
        <td>
          ${statusNorm === 'manutencao'
        ? `<button class="btn-delete" onclick="abrirModalSenha('${escHtml(r.id)}', 'Disponivel')">Liberar</button>`
        : `<button class="btn-delete" style="background:#fff8f0;color:#f59e0b;" onclick="abrirModalSenha('${escHtml(r.id)}', 'Manutencao')">Manutencao</button>`
      }
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
//  REGISTRAR MOVIMENTACAO (Bipar)
// ============================================================
async function registrarMovimentacao() {
  const colaborador = document.getElementById('inputColaborador').value.trim();
  const radioId = document.getElementById('inputRadio').value.trim();
  const feedbackEl = document.getElementById('feedbackMsg');
  const btn = document.getElementById('btnRegistrar');

  clearFeedback(feedbackEl);

  if (!colaborador || !radioId) {
    showFeedback(feedbackEl, 'Preencha o nome do colaborador e o ID do radio.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<div class="loading-spinner" style="width:18px;height:18px;border-width:2px;"></div> Registrando...`;

  const result = await apiRequest({
    method: 'POST',
    data: {
      action: 'registrarMovimentacao',
      colaborador,
      radioId
    }
  });

  btn.disabled = false;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
    Registrar Movimentacao
  `;

  if (!result) return;

  if (result.success) {
    const tipo = result.tipo || 'movimentacao';
    const msg = tipo === 'retirada'
      ? `Radio ${radioId} retirado por ${colaborador}`
      : `Radio ${radioId} devolvido por ${colaborador}`;
    showFeedback(feedbackEl, msg, 'success');
    showToast(msg, 'success');

    document.getElementById('inputColaborador').value = '';
    document.getElementById('inputRadio').value = '';
    document.getElementById('inputColaborador').focus();

    // Recarrega a tabela
    await loadDashboardData();
  } else {
    const errMsg = result.message || 'Erro ao registrar movimentacao.';
    showFeedback(feedbackEl, errMsg, 'error');
    showToast(errMsg, 'error');
  }
}

// ============================================================
//  ALTERAR STATUS DO RADIO
// ============================================================
async function alterarStatusRadio(radioId, novoStatus) {
  const result = await apiRequest({
    method: 'POST',
    data: {
      action: 'alterarStatus',
      radioId,
      novoStatus
    }
  });

  if (result && result.success) {
    showToast(`Status do radio ${radioId} alterado para ${novoStatus}.`, 'success');
    await loadDashboardData();
    if (document.getElementById('screen-cadastro').classList.contains('active')) {
      await loadCadastroData();
    }
  }
}

// ============================================================
//  TELA DE CADASTRO
// ============================================================
async function loadCadastroData() {
  setTableLoading('tbodyRadiosCadastro', 4);
  setTableLoading('tbodyColabs', 3);

  const [radiosRes, colabsRes] = await Promise.all([
    apiRequest({ method: 'GET', data: { action: 'getRadios' } }),
    apiRequest({ method: 'GET', data: { action: 'getColaboradores' } })
  ]);

  if (radiosRes) {
    radiosData = radiosRes.radios || [];
    renderRadiosCadastro(radiosData);
  } else {
    setTableError('tbodyRadiosCadastro', 4, 'Erro ao carregar radios.');
  }

  if (colabsRes) {
    colaboradoresData = colabsRes.colaboradores || [];
    renderColabs(colaboradoresData);
  } else {
    setTableError('tbodyColabs', 3, 'Erro ao carregar colaboradores.');
  }
}

function renderRadiosCadastro(radios) {
  const tbody = document.getElementById('tbodyRadiosCadastro');
  const countEl = document.getElementById('countRadios');

  if (countEl) countEl.textContent = radios.length;

  if (!radios || radios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum radio cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = radios.map(r => {
    const statusNorm = normalizeStatus(r.status);
    const badgeClass = statusBadgeClass(statusNorm);
    return `
      <tr>
        <td><strong>${escHtml(r.id)}</strong></td>
        <td>${escHtml(r.modelo)}</td>
        <td><span class="status-badge ${badgeClass}">${statusDisplayLabel(statusNorm)}</span></td>
        <td>
          <button class="btn-delete" onclick="excluirRadio('${escHtml(r.id)}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Excluir
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderColabs(colabs) {
  const tbody = document.getElementById('tbodyColabs');
  const countEl = document.getElementById('countColabs');

  if (countEl) countEl.textContent = colabs.length;

  if (!colabs || colabs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum colaborador cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = colabs.map(c => `
    <tr>
      <td><strong>${escHtml(c.nome)}</strong></td>
      <td><span style="color:var(--text-muted); font-size:0.8rem;">${escHtml(c.setor)}</span></td>
      <td>
        <button class="btn-delete" onclick="excluirColaborador('${escHtml(c.nome)}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Excluir
        </button>
      </td>
    </tr>
  `).join('');
}

// ============================================================
//  FILTROS DE BUSCA (Cadastro)
// ============================================================
function filtrarListaRadios(term) {
  if (!term) {
    renderRadiosCadastro(radiosData);
    return;
  }
  const t = term.toLowerCase();
  const filtered = radiosData.filter(r =>
    (r.id && r.id.toLowerCase().includes(t)) ||
    (r.modelo && r.modelo.toLowerCase().includes(t))
  );
  renderRadiosCadastro(filtered);
}

function filtrarListaColabs(term) {
  if (!term) {
    renderColabs(colaboradoresData);
    return;
  }
  const t = term.toLowerCase();
  const filtered = colaboradoresData.filter(c =>
    (c.nome && c.nome.toLowerCase().includes(t)) ||
    (c.setor && c.setor.toLowerCase().includes(t))
  );
  renderColabs(filtered);
}


// --- CADASTRAR RADIO ---
async function cadastrarRadio() {
  const id = document.getElementById('radioId').value.trim();
  const modelo = document.getElementById('radioModelo').value.trim();
  const feedbackEl = document.getElementById('feedbackRadio');
  const btn = document.getElementById('btnSalvarRadio');

  clearFeedback(feedbackEl);

  if (!id || !modelo) {
    showFeedback(feedbackEl, 'Preencha o ID e o Modelo do radio.', 'error');
    return;
  }

  btn.disabled = true;

  const result = await apiRequest({
    method: 'POST',
    data: { action: 'cadastrarRadio', id, modelo }
  });

  btn.disabled = false;

  if (result && result.success) {
    showFeedback(feedbackEl, `Radio "${id}" cadastrado com sucesso!`, 'success');
    showToast(`Radio ${id} cadastrado!`, 'success');
    document.getElementById('radioId').value = '';
    document.getElementById('radioModelo').value = '';
    loadCadastroData();
  } else {
    const msg = (result && result.message) || 'Erro ao cadastrar radio.';
    showFeedback(feedbackEl, msg, 'error');
  }
}

// --- CADASTRAR COLABORADOR ---
async function cadastrarColaborador() {
  const nome = document.getElementById('colabNome').value.trim();
  const setor = document.getElementById('colabSetor').value.trim();
  const feedbackEl = document.getElementById('feedbackColab');
  const btn = document.getElementById('btnSalvarColab');

  clearFeedback(feedbackEl);

  if (!nome || !setor) {
    showFeedback(feedbackEl, 'Preencha o nome e a funcao do colaborador.', 'error');
    return;
  }

  btn.disabled = true;

  const result = await apiRequest({
    method: 'POST',
    data: { action: 'cadastrarColaborador', nome, setor }
  });

  btn.disabled = false;

  if (result && result.success) {
    showFeedback(feedbackEl, `Colaborador "${nome}" cadastrado!`, 'success');
    showToast(`Colaborador ${nome} cadastrado!`, 'success');
    document.getElementById('colabNome').value = '';
    document.getElementById('colabSetor').value = '';
    loadCadastroData();
  } else {
    const msg = (result && result.message) || 'Erro ao cadastrar colaborador.';
    showFeedback(feedbackEl, msg, 'error');
  }
}

// --- EXCLUIR RADIO ---
async function excluirRadio(id) {
  if (!confirm(`Deseja excluir o radio "${id}"? Esta acao nao pode ser desfeita.`)) return;

  const result = await apiRequest({
    method: 'POST',
    data: { action: 'excluirRadio', id }
  });

  if (result && result.success) {
    showToast(`Radio ${id} excluido.`, 'info');
    loadCadastroData();
  } else {
    showToast('Erro ao excluir radio.', 'error');
  }
}

// --- EXCLUIR COLABORADOR ---
async function excluirColaborador(nome) {
  if (!confirm(`Deseja excluir o colaborador "${nome}"?`)) return;

  const result = await apiRequest({
    method: 'POST',
    data: { action: 'excluirColaborador', nome }
  });

  if (result && result.success) {
    showToast(`Colaborador ${nome} excluido.`, 'info');
    loadCadastroData();
  } else {
    showToast('Erro ao excluir colaborador.', 'error');
  }
}

// ============================================================
//  HISTORICO DE MOVIMENTACOES
// ============================================================
async function loadHistorico() {
  setTableLoading('tbodyHistorico', 6);

  const result = await apiRequest({ method: 'GET', data: { action: 'getMovimentacoes' } });

  if (!result) {
    setTableError('tbodyHistorico', 6, 'Erro ao carregar historico.');
    return;
  }

  const movimentacoes = result.movimentacoes || [];
  renderHistorico(movimentacoes);
}

function renderHistorico(movs) {
  const tbody = document.getElementById('tbodyHistorico');

  if (!movs || movs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--text-muted);">Nenhuma movimentacao registrada ainda.</td></tr>`;
    return;
  }

  // Exibe em ordem decrescente (mais recente primeiro)
  const reversed = [...movs].reverse();

  tbody.innerHTML = reversed.map((m, idx) => {
    const { cls, label } = tipoMovimentacao(m.tipo || '');

    return `
      <tr>
        <td style="color:var(--text-muted); font-size:0.78rem;">${movs.length - idx}</td>
        <td style="font-size:0.78rem; color:var(--text-muted);">${formatDateTime(m.dataHora)}</td>
        <td><strong>${escHtml(m.radioId)}</strong></td>
        <td>${escHtml(m.colaborador)}</td>
        <td style="color:var(--text-muted);">${escHtml(m.setor) || '—'}</td>
        <td><span class="${cls}">${label}</span></td>
      </tr>
    `;
  }).join('');
}

/**
 * Identifica o tipo da movimentacao sem usar normalizeStatus
 * (que e especifica para status de radios e confundiria Retirada com Em Uso).
 */
function tipoMovimentacao(tipoRaw) {
  const t = tipoRaw.toString().toLowerCase().trim();
  if (t.includes('retir')) return { cls: 'tipo-retirada', label: 'Retirada' };
  if (t.includes('manut') && t.includes('retorno')) return { cls: 'tipo-devolucao', label: 'Retorno Manut.' };
  if (t.includes('manut')) return { cls: 'tipo-manutencao', label: 'Manutencao' };
  // Devolucao como fallback padrao
  return { cls: 'tipo-devolucao', label: 'Devolucao' };
}



// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    info: '💡',
    warning: '⚠️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-text">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================================
//  UTILITARIOS DE UI
// ============================================================
function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = `feedback-msg ${type}`;
  setTimeout(() => clearFeedback(el), 5000);
}

function clearFeedback(el) {
  el.textContent = '';
  el.className = 'feedback-msg';
}

function setTableLoading(tbodyId, cols) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="${cols}" class="loading-cell">
        <div class="loading-spinner"></div>
        <span>Carregando dados...</span>
      </td>
    </tr>
  `;
}

function setTableError(tbodyId, cols, msg) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="${cols}" style="text-align:center; padding:28px; color:#ef4444; font-size:0.83rem;">
        ⚠️ ${msg}
      </td>
    </tr>
  `;
}

// ============================================================
//  UTILITARIOS DE DADOS
// ============================================================
function normalizeStatus(status) {
  if (!status) return '';
  const s = status.toString().toLowerCase().trim();
  if (s.includes('dispon')) return 'disponivel';
  if (s.includes('uso') || s.includes('retirad')) return 'em uso';
  if (s.includes('manut')) return 'manutencao';
  return s;
}

function statusBadgeClass(statusNorm) {
  if (statusNorm === 'disponivel') return 'status-disponivel';
  if (statusNorm === 'em uso') return 'status-em-uso';
  if (statusNorm === 'manutencao') return 'status-manutencao';
  return '';
}

function statusDisplayLabel(statusNorm) {
  if (statusNorm === 'disponivel') return 'Disponivel';
  if (statusNorm === 'em uso') return 'Em Uso';
  if (statusNorm === 'manutencao') return 'Manutencao';
  return statusNorm || '—';
}

function statusDot(statusNorm) {
  if (statusNorm === 'disponivel') return '🟢';
  if (statusNorm === 'em uso') return '🟣';
  if (statusNorm === 'manutencao') return '🟡';
  return '';
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return value;
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  MODAL DE SENHA PARA MANUTENCAO
// ============================================================
let pendingManutencaoRadioId = null;
let pendingManutencaoStatus = null;

function abrirModalSenha(radioId, novoStatus) {
  pendingManutencaoRadioId = radioId;
  pendingManutencaoStatus = novoStatus;

  const inputSenha = document.getElementById('inputSenhaManutencao');
  if (inputSenha) inputSenha.value = '';

  const feedbackEl = document.getElementById('feedbackSenha');
  if (feedbackEl) clearFeedback(feedbackEl);

  const titulo = novoStatus === 'Manutencao' ? 'Enviar para Manutencao' : 'Liberar da Manutencao';
  const modalTitulo = document.getElementById('modalSenhaTitulo');
  if (modalTitulo) modalTitulo.textContent = titulo;

  const modal = document.getElementById('modalSenhaManutencao');
  if (modal) modal.classList.add('open');
}

function fecharModalSenha() {
  const modal = document.getElementById('modalSenhaManutencao');
  if (modal) modal.classList.remove('open');

  pendingManutencaoRadioId = null;
  pendingManutencaoStatus = null;
}

async function confirmarSenhaManutencao() {
  const inputSenha = document.getElementById('inputSenhaManutencao');
  const feedbackEl = document.getElementById('feedbackSenha');

  if (feedbackEl) clearFeedback(feedbackEl);

  if (!inputSenha || inputSenha.value !== '@Ferrovias') {
    if (feedbackEl) showFeedback(feedbackEl, 'Senha incorreta!', 'error');
    return;
  }

  const radioId = pendingManutencaoRadioId;
  const novoStatus = pendingManutencaoStatus;

  fecharModalSenha();

  if (radioId && novoStatus) {
    await alterarStatusRadio(radioId, novoStatus);
  }
}

// ============================================================
//  MODAL DE SENHA PARA ACESSO (CADASTRO)
// ============================================================
function abrirModalSenhaAcesso() {
  const inputSenha = document.getElementById('inputSenhaAcesso');
  if (inputSenha) inputSenha.value = '';

  const feedbackEl = document.getElementById('feedbackSenhaAcesso');
  if (feedbackEl) clearFeedback(feedbackEl);

  const modal = document.getElementById('modalSenhaAcesso');
  if (modal) modal.classList.add('open');

  // Foca no input após abrir
  setTimeout(() => {
    if (inputSenha) inputSenha.focus();
  }, 100);
}

function fecharModalSenhaAcesso() {
  const modal = document.getElementById('modalSenhaAcesso');
  if (modal) modal.classList.remove('open');
}

function confirmarSenhaAcesso() {
  const inputSenha = document.getElementById('inputSenhaAcesso');
  const feedbackEl = document.getElementById('feedbackSenhaAcesso');

  if (feedbackEl) clearFeedback(feedbackEl);

  if (!inputSenha || inputSenha.value !== '@Ferrovias') {
    if (feedbackEl) showFeedback(feedbackEl, 'Senha incorreta!', 'error');
    return;
  }

  fecharModalSenhaAcesso();
  showScreen('cadastro');
}

