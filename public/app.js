const tbodyEl = document.getElementById('printer-tbody');
const emptyStateEl = document.getElementById('empty-state');
const formEl = document.getElementById('printer-form');
const formTitleEl = document.getElementById('form-title');
const submitBtnEl = document.getElementById('submit-btn');
const cancelEditBtnEl = document.getElementById('cancel-edit-btn');
const formErrorEl = document.getElementById('form-error');
const idFieldEl = formEl.elements.id;

let lastPrinters = [];

const STATE_LABELS = {
  RUNNING: 'Printing',
  PAUSE: 'Paused',
  FINISH: 'Finished',
  FAILED: 'Failed',
  IDLE: 'Idle',
};

function stateLabel(state) {
  if (!state) return 'Unknown';
  return STATE_LABELS[state] || state;
}

function formatMinutes(min) {
  if (min === null || min === undefined) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTemp(actual, target) {
  if (actual === null || actual === undefined) return '--';
  const a = Math.round(actual);
  if (target === null || target === undefined) return `${a}°C`;
  return `${a}°C / ${Math.round(target)}°C`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderPrinters(printers) {
  emptyStateEl.hidden = printers.length > 0;

  tbodyEl.innerHTML = printers.map((p) => {
    const s = p.status;
    const percent = s.percent ?? 0;
    return `
      <tr data-id="${p.id}">
        <td><span class="status-dot ${s.connected ? 'online' : ''}"></span>${escapeHtml(p.name)}</td>
        <td>${stateLabel(s.gcodeState)}</td>
        <td>${escapeHtml(s.subtaskName) || '--'}</td>
        <td>
          <span class="progress-track"><span class="progress-fill" style="width: ${percent}%"></span></span>${s.percent ?? '--'}%
        </td>
        <td>${formatMinutes(s.remainingMinutes)}</td>
        <td>${s.layerNum ?? '--'}/${s.totalLayerNum ?? '--'}</td>
        <td>${formatTemp(s.nozzleTemp, s.nozzleTarget)}</td>
        <td>${formatTemp(s.bedTemp, s.bedTarget)}</td>
        <td>
          <button class="row-btn edit-btn" data-id="${p.id}">Edit</button>
          <button class="row-btn remove-btn" data-id="${p.id}">Remove</button>
          ${s.lastError ? `<div class="row-error">${escapeHtml(s.lastError)}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

async function refresh() {
  try {
    const res = await fetch('/api/printers');
    lastPrinters = await res.json();
    renderPrinters(lastPrinters);
  } catch (err) {
    tbodyEl.innerHTML = '';
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = `Failed to reach server: ${err.message}`;
  }
}

function enterEditMode(printer) {
  idFieldEl.value = printer.id;
  formEl.elements.name.value = printer.name;
  formEl.elements.ip.value = printer.ip;
  formEl.elements.accessCode.value = '';
  formEl.elements.accessCode.placeholder = 'Leave blank to keep current access code';
  formEl.elements.accessCode.required = false;
  formEl.elements.serial.value = printer.serial;
  formTitleEl.textContent = `Edit Printer: ${printer.name}`;
  submitBtnEl.textContent = 'Save Changes';
  cancelEditBtnEl.hidden = false;
  formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function exitEditMode() {
  formEl.reset();
  idFieldEl.value = '';
  formEl.elements.accessCode.placeholder = 'LAN access code (printer settings)';
  formEl.elements.accessCode.required = true;
  formTitleEl.textContent = 'Add Printer';
  submitBtnEl.textContent = 'Add Printer';
  cancelEditBtnEl.hidden = true;
  formErrorEl.textContent = '';
}

tbodyEl.addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;

  if (e.target.matches('.remove-btn')) {
    await fetch(`/api/printers/${id}`, { method: 'DELETE' });
    refresh();
  } else if (e.target.matches('.edit-btn')) {
    const printer = lastPrinters.find((p) => p.id === id);
    if (printer) enterEditMode(printer);
  }
});

cancelEditBtnEl.addEventListener('click', exitEditMode);

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  formErrorEl.textContent = '';

  const id = idFieldEl.value;
  const data = Object.fromEntries(new FormData(formEl).entries());
  delete data.id;

  let url = '/api/printers';
  let method = 'POST';
  if (id) {
    url = `/api/printers/${id}`;
    method = 'PUT';
  }

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    formErrorEl.textContent = body.error || 'Failed to save printer';
    return;
  }

  exitEditMode();
  refresh();
});

refresh();
setInterval(refresh, 3000);
