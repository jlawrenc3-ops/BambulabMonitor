const mqtt = require('mqtt');
const crypto = require('crypto');

const STATE_LABELS = {
  RUNNING: 'Printing',
  PAUSE: 'Paused',
  FINISH: 'Finished',
  FAILED: 'Failed',
  IDLE: 'Idle',
};

function stateLabel(state) {
  return STATE_LABELS[state] || state;
}

function formatTemp(actual, target) {
  const a = Math.round(actual);
  if (target === undefined || target === null) return `${a}°C`;
  return `${a}°C / ${Math.round(target)}°C`;
}

function hexToCss(trayColor) {
  if (!trayColor) return null;
  const rgb = trayColor.slice(0, 6);
  return /^[0-9a-fA-F]{6}$/.test(rgb) ? `#${rgb}` : null;
}

function traySlotMetric(column, sublabel, tray) {
  if (!tray) return null;
  const type = tray.tray_type || '';
  const remain = Number(tray.remain);

  let value;
  if (!type) {
    value = 'Empty';
  } else if (Number.isFinite(remain) && remain >= 0) {
    value = `${type} ${remain}%`;
  } else {
    value = type;
  }

  const metric = { column, value };
  if (sublabel) metric.sublabel = sublabel;
  const swatch = type ? hexToCss(tray.tray_color) : null;
  if (swatch) metric.swatch = swatch;
  return metric;
}

module.exports = {
  id: 'bambu',
  label: 'Bambu Lab Printer',
  fields: [
    { name: 'ip', label: 'IP Address', placeholder: '192.168.1.50', required: true },
    {
      name: 'accessCode',
      label: 'Access Code',
      placeholder: 'LAN access code (printer settings)',
      required: true,
      secret: true,
      inputType: 'password',
    },
    { name: 'serial', label: 'Serial Number', placeholder: 'Printer serial number', required: true },
  ],

  connect(config, handlers) {
    const client = mqtt.connect(`mqtts://${config.ip}:8883`, {
      username: 'bblp',
      password: config.accessCode,
      rejectUnauthorized: false, // Bambu printers use a self-signed LAN cert
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clientId: `bambustatuschecker_${crypto.randomBytes(4).toString('hex')}`,
    });

    // Bambu pushes partial updates, so accumulate known values locally and
    // re-emit the full metrics set on every message.
    const known = {};

    client.on('connect', () => {
      handlers.onConnectionChange(true, null);
      client.subscribe(`device/${config.serial}/report`, (err) => {
        if (err) handlers.onConnectionChange(true, `Subscribe failed: ${err.message}`);
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

        const patch = {};
        if (p.gcode_state !== undefined) patch.state = stateLabel(p.gcode_state);
        if (p.subtask_name !== undefined) patch.detail = p.subtask_name;
        if (p.mc_percent !== undefined) patch.percent = p.mc_percent;
        if (p.mc_remaining_time !== undefined) patch.remainingMinutes = p.mc_remaining_time;

        if (p.nozzle_temper !== undefined) known.nozzle = p.nozzle_temper;
        if (p.nozzle_target_temper !== undefined) known.nozzleTarget = p.nozzle_target_temper;
        if (p.bed_temper !== undefined) known.bed = p.bed_temper;
        if (p.bed_target_temper !== undefined) known.bedTarget = p.bed_target_temper;
        if (p.layer_num !== undefined) known.layer = p.layer_num;
        if (p.total_layer_num !== undefined) known.totalLayer = p.total_layer_num;
        if (p.ams && Array.isArray(p.ams.ams)) known.amsUnits = p.ams.ams;

        const metrics = [];
        if (known.nozzle !== undefined) metrics.push({ column: 'Nozzle', value: formatTemp(known.nozzle, known.nozzleTarget) });
        if (known.bed !== undefined) metrics.push({ column: 'Bed', value: formatTemp(known.bed, known.bedTarget) });
        if (known.layer !== undefined) metrics.push({ column: 'Layer', value: `${known.layer}/${known.totalLayer ?? '?'}` });

        if (known.amsUnits) {
          known.amsUnits.forEach((unit, unitIdx) => {
            (unit.tray || []).forEach((tray, trayIdx) => {
              const m = traySlotMetric(`AMS${unitIdx + 1}`, String(trayIdx + 1), tray);
              if (m) metrics.push(m);
            });
          });
        }

        patch.metrics = metrics;

        handlers.onStatus(patch);
      } catch (err) {
        // Ignore malformed/partial messages
      }
    });

    client.on('close', () => handlers.onConnectionChange(false, null));
    client.on('error', (err) => handlers.onConnectionChange(false, err.message));

    return client;
  },
};
