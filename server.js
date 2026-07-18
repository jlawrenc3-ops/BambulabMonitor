const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const deviceTypes = require('./deviceTypes');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'printers.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, {config: object, client: object|null, status: object}>} */
const devices = new Map();

function loadDevices() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read printers.json, starting empty:', err.message);
    return [];
  }
}

function saveDevices() {
  const configs = Array.from(devices.values()).map((d) => d.config);
  fs.writeFileSync(DATA_FILE, JSON.stringify(configs, null, 2));
}

function defaultStatus() {
  return {
    connected: false,
    lastUpdate: null,
    lastError: null,
    state: null,
    detail: null,
    percent: null,
    remainingMinutes: null,
    metrics: [],
  };
}

class ValidationError extends Error {}

function buildConfig(deviceType, body, existingConfig) {
  if (!body || !body.name) throw new ValidationError('name is required');

  const config = { name: body.name, type: deviceType.id };
  for (const field of deviceType.fields) {
    let value = body[field.name];
    if ((value === undefined || value === '') && field.secret && existingConfig) {
      value = existingConfig[field.name];
    }
    if (field.required && !value) {
      throw new ValidationError(`${field.label} is required`);
    }
    config[field.name] = value === undefined ? '' : value;
  }
  return config;
}

function connectDevice(entry) {
  const deviceType = deviceTypes[entry.config.type];
  if (!deviceType) {
    entry.status.lastError = `Unknown device type: ${entry.config.type}`;
    return;
  }

  if (entry.client) {
    entry.client.end(true);
  }

  entry.client = deviceType.connect(entry.config, {
    onConnectionChange(connected, error) {
      entry.status.connected = connected;
      entry.status.lastError = error;
    },
    onStatus(patch) {
      Object.assign(entry.status, patch);
      entry.status.lastUpdate = new Date().toISOString();
    },
  });
}

function toPublicDevice(entry) {
  const { id, name, type } = entry.config;
  const deviceType = deviceTypes[type];
  const config = {};
  if (deviceType) {
    for (const field of deviceType.fields) {
      if (!field.secret) config[field.name] = entry.config[field.name];
    }
  }
  return { id, name, type, config, status: entry.status };
}

// Bootstrap from disk
for (const config of loadDevices()) {
  if (!config.type) config.type = 'bambu'; // back-compat with pre-generic printers.json
  const entry = { config, client: null, status: defaultStatus() };
  devices.set(config.id, entry);
  connectDevice(entry);
}

app.get('/api/device-types', (_req, res) => {
  res.json(
    Object.values(deviceTypes).map((dt) => ({ id: dt.id, label: dt.label, fields: dt.fields }))
  );
});

app.get('/api/printers', (_req, res) => {
  res.json(Array.from(devices.values()).map(toPublicDevice));
});

app.post('/api/printers', (req, res) => {
  const deviceType = deviceTypes[req.body && req.body.type];
  if (!deviceType) return res.status(400).json({ error: 'A valid device type is required' });

  try {
    const config = buildConfig(deviceType, req.body);
    config.id = crypto.randomUUID();

    const entry = { config, client: null, status: defaultStatus() };
    devices.set(config.id, entry);
    saveDevices();
    connectDevice(entry);

    res.status(201).json(toPublicDevice(entry));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.put('/api/printers/:id', (req, res) => {
  const entry = devices.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Printer not found' });

  const deviceType = deviceTypes[entry.config.type];
  if (!deviceType) return res.status(400).json({ error: `Unknown device type: ${entry.config.type}` });

  try {
    const newConfig = buildConfig(deviceType, req.body, entry.config);
    newConfig.id = entry.config.id;

    const reconnectNeeded = deviceType.fields.some((f) => newConfig[f.name] !== entry.config[f.name]);

    entry.config = newConfig;
    saveDevices();

    if (reconnectNeeded) {
      entry.status = defaultStatus();
      connectDevice(entry);
    }

    res.json(toPublicDevice(entry));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.delete('/api/printers/:id', (req, res) => {
  const entry = devices.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Printer not found' });

  if (entry.client) entry.client.end(true);
  devices.delete(req.params.id);
  saveDevices();

  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Bambu Status Checker running at http://localhost:${PORT}`);
});
