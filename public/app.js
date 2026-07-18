const tbodyEl = document.getElementById('printer-tbody');
const emptyStateEl = document.getElementById('empty-state');
const formEl = document.getElementById('printer-form');
const formTitleEl = document.getElementById('form-title');
const submitBtnEl = document.getElementById('submit-btn');
const cancelEditBtnEl = document.getElementById('cancel-edit-btn');
const formErrorEl = document.getElementById('form-error');
const typeSelectEl = document.getElementById('type-select');
const dynamicFieldsEl = document.getElementById('dynamic-fields');
const notifBtnEl = document.getElementById('enable-notif-btn');
const idFieldEl = formEl.elements.id;

let lastPrinters = [];
let deviceTypes = [];
let editingId = null;

function formatMinutes(min) {
  if (min === null || min === undefined) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function updateNotifButton() {
  if (!('Notification' in window)) {
    notifBtnEl.hidden = true;
    return;
  }
  notifBtnEl.hidden = Notification.permission === 'granted';
}

notifBtnEl.addEventListener('click', async () => {
  await Notification.requestPermission();
  updateNotifButton();
});

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch (err) {
    // Some contexts (e.g. mobile browsers) require a service worker; ignore.
  }
}

function checkForNotifications(printers) {
  for (const p of printers) {
    const prev = lastPrinters.find((x) => x.id === p.id);
    if (!prev) continue; // skip first appearance of a device (no baseline to compare)

    const status = p.status;
    const prevStatus = prev.status;

    if (status.lastError && !prevStatus.lastError) {
      notify(`${p.name}: Error`, status.lastError);
    }
    if (status.state === 'Finished' && prevStatus.state !== 'Finished') {
      notify(`${p.name}: Print finished`, status.detail || '');
    }
    if (status.state === 'Failed' && prevStatus.state !== 'Failed') {
      notify(`${p.name}: Print failed`, status.detail || '');
    }
  }
}

function currentDeviceType() {
  return deviceTypes.find((t) => t.id === typeSelectEl.value);
}

function renderDynamicFields(prefill) {
  const deviceType = currentDeviceType();
  if (!deviceType) {
    dynamicFieldsEl.innerHTML = '';
    return;
  }

  dynamicFieldsEl.innerHTML = deviceType.fields.map((f) => {
    const inputType = f.inputType || 'text';
    const value = prefill && prefill[f.name] !== undefined ? prefill[f.name] : '';
    const placeholder = f.secret && editingId ? 'Leave blank to keep current value' : (f.placeholder || '');
    const required = f.required && !(f.secret && editingId);

    if (inputType === 'checkbox') {
      return `
        <label class="checkbox-label">
          <input type="checkbox" name="${f.name}" ${value ? 'checked' : ''} />
          ${escapeHtml(f.label)}
        </label>
      `;
    }

    return `
      <label>
        ${escapeHtml(f.label)}
        <input type="${inputType}" name="${f.name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} />
      </label>
    `;
  }).join('');
}

async function loadDeviceTypes() {
  const res = await fetch('/api/device-types');
  deviceTypes = await res.json();
  typeSelectEl.innerHTML = deviceTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  renderDynamicFields();
}

typeSelectEl.addEventListener('change', () => renderDynamicFields());

function renderPrinters(printers) {
  emptyStateEl.hidden = printers.length > 0;

  tbodyEl.innerHTML = printers.map((p) => {
    const s = p.status;
    const percent = s.percent ?? null;
    const metrics = (s.metrics || []).map((m) => `${escapeHtml(m.label)}: ${escapeHtml(m.value)}`).join(', ');
    return `
      <tr data-id="${p.id}">
        <td><span class="status-dot ${s.connected ? 'online' : ''}"></span>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(s.state) || 'Unknown'}</td>
        <td>${escapeHtml(s.detail) || '--'}</td>
        <td>
          ${percent === null ? '--' : `<span class="progress-track"><span class="progress-fill" style="width: ${percent}%"></span></span>${percent}%`}
        </td>
        <td>${formatMinutes(s.remainingMinutes)}</td>
        <td>${metrics || '--'}</td>
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
    const printers = await res.json();
    checkForNotifications(printers);
    lastPrinters = printers;
    renderPrinters(lastPrinters);
  } catch (err) {
    tbodyEl.innerHTML = '';
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = `Failed to reach server: ${err.message}`;
  }
}

function enterEditMode(printer) {
  editingId = printer.id;
  idFieldEl.value = printer.id;
  formEl.elements.name.value = printer.name;
  typeSelectEl.value = printer.type;
  typeSelectEl.disabled = true;
  renderDynamicFields(printer.config);
  formTitleEl.textContent = `Edit Device: ${printer.name}`;
  submitBtnEl.textContent = 'Save Changes';
  cancelEditBtnEl.hidden = false;
  formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function exitEditMode() {
  editingId = null;
  formEl.reset();
  idFieldEl.value = '';
  typeSelectEl.disabled = false;
  renderDynamicFields();
  formTitleEl.textContent = 'Add Device';
  submitBtnEl.textContent = 'Add Device';
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

  const deviceType = currentDeviceType();
  const formData = new FormData(formEl);
  const data = { name: formData.get('name'), type: typeSelectEl.value };
  for (const f of deviceType.fields) {
    data[f.name] = f.inputType === 'checkbox' ? formEl.elements[f.name].checked : formData.get(f.name);
  }

  const url = editingId ? `/api/printers/${editingId}` : '/api/printers';
  const method = editingId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    formErrorEl.textContent = body.error || 'Failed to save device';
    return;
  }

  exitEditMode();
  refresh();
});

(async function init() {
  updateNotifButton();
  await loadDeviceTypes();
  await refresh();
  setInterval(refresh, 3000);
})();
