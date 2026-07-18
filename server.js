const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mqtt = require('mqtt');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'printers.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, {config: object, client: import('mqtt').MqttClient|null, status: object}>} */
const printers = new Map();

function loadPrinters() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read printers.json, starting empty:', err.message);
    return [];
  }
}

function savePrinters() {
  const configs = Array.from(printers.values()).map((p) => p.config);
  fs.writeFileSync(DATA_FILE, JSON.stringify(configs, null, 2));
}

function defaultStatus() {
  return {
    connected: false,
    lastUpdate: null,
    lastError: null,
    gcodeState: null,
    percent: null,
    remainingMinutes: null,
    bedTemp: null,
    bedTarget: null,
    nozzleTemp: null,
    nozzleTarget: null,
    subtaskName: null,
    layerNum: null,
    totalLayerNum: null,
  };
}

function connectPrinter(entry) {
  const { config } = entry;

  if (entry.client) {
    entry.client.end(true);
  }

  const client = mqtt.connect(`mqtts://${config.ip}:8883`, {
    username: 'bblp',
    password: config.accessCode,
    rejectUnauthorized: false, // Bambu printers use a self-signed LAN cert
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clientId: `bambustatuschecker_${crypto.randomBytes(4).toString('hex')}`,
  });
  entry.client = client;

  client.on('connect', () => {
    entry.status.connected = true;
    entry.status.lastError = null;
    client.subscribe(`device/${config.serial}/report`, (err) => {
      if (err) entry.status.lastError = `Subscribe failed: ${err.message}`;
    });
    client.publish(
      `device/${config.serial}/request`,
      JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } })
    );
  });

  client.on('message', (_topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      const p = msg.print;
      if (!p) return;
      entry.status.lastUpdate = new Date().toISOString();
      if (p.gcode_state !== undefined) entry.status.gcodeState = p.gcode_state;
      if (p.mc_percent !== undefined) entry.status.percent = p.mc_percent;
      if (p.mc_remaining_time !== undefined) entry.status.remainingMinutes = p.mc_remaining_time;
      if (p.bed_temper !== undefined) entry.status.bedTemp = p.bed_temper;
      if (p.bed_target_temper !== undefined) entry.status.bedTarget = p.bed_target_temper;
      if (p.nozzle_temper !== undefined) entry.status.nozzleTemp = p.nozzle_temper;
      if (p.nozzle_target_temper !== undefined) entry.status.nozzleTarget = p.nozzle_target_temper;
      if (p.subtask_name !== undefined) entry.status.subtaskName = p.subtask_name;
      if (p.layer_num !== undefined) entry.status.layerNum = p.layer_num;
      if (p.total_layer_num !== undefined) entry.status.totalLayerNum = p.total_layer_num;
    } catch (err) {
      // Ignore malformed/partial messages
    }
  });

  client.on('close', () => {
    entry.status.connected = false;
  });

  client.on('error', (err) => {
    entry.status.connected = false;
    entry.status.lastError = err.message;
  });
}

function toPublicPrinter(entry) {
  const { id, name, ip, serial } = entry.config;
  return { id, name, ip, serial, status: entry.status };
}

// Bootstrap from disk
for (const config of loadPrinters()) {
  const entry = { config, client: null, status: defaultStatus() };
  printers.set(config.id, entry);
  connectPrinter(entry);
}

app.get('/api/printers', (_req, res) => {
  res.json(Array.from(printers.values()).map(toPublicPrinter));
});

app.post('/api/printers', (req, res) => {
  const { name, ip, accessCode, serial } = req.body || {};
  if (!name || !ip || !accessCode || !serial) {
    return res.status(400).json({ error: 'name, ip, accessCode, and serial are all required' });
  }

  const config = { id: crypto.randomUUID(), name, ip, accessCode, serial };
  const entry = { config, client: null, status: defaultStatus() };
  printers.set(config.id, entry);
  savePrinters();
  connectPrinter(entry);

  res.status(201).json(toPublicPrinter(entry));
});

app.put('/api/printers/:id', (req, res) => {
  const entry = printers.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Printer not found' });

  const { name, ip, serial } = req.body || {};
  const accessCode = (req.body && req.body.accessCode) || entry.config.accessCode;
  if (!name || !ip || !accessCode || !serial) {
    return res.status(400).json({ error: 'name, ip, accessCode, and serial are all required' });
  }

  const reconnectNeeded =
    ip !== entry.config.ip || accessCode !== entry.config.accessCode || serial !== entry.config.serial;

  entry.config = { ...entry.config, name, ip, accessCode, serial };
  savePrinters();

  if (reconnectNeeded) {
    entry.status = defaultStatus();
    connectPrinter(entry);
  }

  res.json(toPublicPrinter(entry));
});

app.delete('/api/printers/:id', (req, res) => {
  const entry = printers.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Printer not found' });

  if (entry.client) entry.client.end(true);
  printers.delete(req.params.id);
  savePrinters();

  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Bambu Status Checker running at http://localhost:${PORT}`);
});
