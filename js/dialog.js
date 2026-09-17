import { icon as svgIcon } from './icons.js';
// ── Custom Dialog System (replaces browser confirm/prompt/alert) ──

let resolveDialog = null;

function getOrCreateOverlay() {
  let el = document.getElementById('dialogOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dialogOverlay';
    el.className = 'confirm-overlay';
    el.innerHTML = `
      <div class="confirm-box" id="dialogBox">
        <div class="confirm-icon" id="dialogIcon"></div>
        <div class="confirm-title" id="dialogTitle"></div>
        <div class="confirm-msg" id="dialogMsg"></div>
        <div class="confirm-input" id="dialogInputWrap" style="display:none;">
          <input type="text" id="dialogInput" style="text-align:center;"/>
        </div>
        <div class="confirm-actions" id="dialogActions"></div>
      </div>`;
    document.body.appendChild(el);
  }
  return el;
}

function closeDialog(val) {
  const el = document.getElementById('dialogOverlay');
  if (el) el.classList.remove('open');
  if (resolveDialog) { resolveDialog(val); resolveDialog = null; }
}

// ── alert replacement ──
export function showAlert(msg, { title = 'Notice', icon = 'info', type = '' } = {}) {
  return new Promise(resolve => {
    resolveDialog = resolve;
    const el = getOrCreateOverlay();
    document.getElementById('dialogIcon').innerHTML = svgIcon(icon);
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMsg').textContent = msg;
    document.getElementById('dialogInputWrap').style.display = 'none';
    document.getElementById('dialogActions').innerHTML = `
      <button class="btn btn-gold btn-full" onclick="window._closeDialog(true)">OK</button>`;
    el.classList.add('open');
  });
}

// ── confirm replacement ──
export function showConfirm(msg, { title = 'Confirm', icon = 'alert', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    resolveDialog = resolve;
    const el = getOrCreateOverlay();
    document.getElementById('dialogIcon').innerHTML = svgIcon(icon);
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMsg').textContent = msg;
    document.getElementById('dialogInputWrap').style.display = 'none';
    const btnClass = danger ? 'btn-danger' : 'btn-gold';
    document.getElementById('dialogActions').innerHTML = `
      <button class="btn btn-outline" onclick="window._closeDialog(false)">${cancelText}</button>
      <button class="btn ${btnClass}" onclick="window._closeDialog(true)">${confirmText}</button>`;
    el.classList.add('open');
  });
}

// ── prompt replacement ──
export function showPrompt(msg, { title = 'Enter', icon = 'edit', placeholder = '', defaultVal = '', confirmText = 'OK', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    resolveDialog = resolve;
    const el = getOrCreateOverlay();
    document.getElementById('dialogIcon').innerHTML = svgIcon(icon);
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMsg').textContent = msg;
    const wrap = document.getElementById('dialogInputWrap');
    const input = document.getElementById('dialogInput');
    input.placeholder = placeholder;
    input.value = defaultVal;
    wrap.style.display = 'block';
    document.getElementById('dialogActions').innerHTML = `
      <button class="btn btn-outline" onclick="window._closeDialog(null)">${cancelText}</button>
      <button class="btn btn-gold" onclick="window._closeDialogInput()">${confirmText}</button>`;
    el.classList.add('open');
    setTimeout(() => input.focus(), 300);
    input.onkeydown = e => { if (e.key === 'Enter') window._closeDialogInput(); };
  });
}

// ── success toast ──
export function showSuccess(msg) {
  let t = document.getElementById('globalToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'globalToast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show success';
  setTimeout(() => t.className = 'toast', 2500);
}

// ── error toast ──
export function showError(msg) {
  let t = document.getElementById('globalToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'globalToast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show error';
  setTimeout(() => t.className = 'toast', 3000);
}

// Global handlers
window._closeDialog = val => closeDialog(val);
window._closeDialogInput = () => {
  const val = document.getElementById('dialogInput')?.value ?? null;
  closeDialog(val);
};
