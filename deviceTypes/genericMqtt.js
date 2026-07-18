const mqtt = require('mqtt');
const crypto = require('crypto');

module.exports = {
  id: 'generic-mqtt',
  label: 'Generic MQTT Device',
  fields: [
    { name: 'host', label: 'Broker Host', placeholder: '192.168.1.60', required: true },
    { name: 'port', label: 'Broker Port', placeholder: '1883', required: false, inputType: 'number' },
    { name: 'topic', label: 'Topic to Subscribe', placeholder: 'device/status', required: true },
    { name: 'username', label: 'Username', required: false },
    { name: 'password', label: 'Password', required: false, secret: true, inputType: 'password' },
    { name: 'tls', label: 'Use TLS', required: false, inputType: 'checkbox' },
  ],

  connect(config, handlers) {
    const useTls = config.tls === true || config.tls === 'true' || config.tls === 'on';
    const protocol = useTls ? 'mqtts' : 'mqtt';
    const port = config.port || (useTls ? 8883 : 1883);

    const client = mqtt.connect(`${protocol}://${config.host}:${port}`, {
      username: config.username || undefined,
      password: config.password || undefined,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clientId: `bambustatuschecker_${crypto.randomBytes(4).toString('hex')}`,
    });

    client.on('connect', () => {
      handlers.onConnectionChange(true, null);
      client.subscribe(config.topic, (err) => {
        if (err) handlers.onConnectionChange(true, `Subscribe failed: ${err.message}`);
      });
    });

    client.on('message', (topic, payload) => {
      const raw = payload.toString();
      const patch = { state: 'Message received', detail: topic };
      try {
        const msg = JSON.parse(raw);
        patch.metrics = Object.entries(msg)
          .filter(([, v]) => typeof v !== 'object')
          .slice(0, 6)
          .map(([k, v]) => ({ label: k, value: String(v) }));
      } catch (err) {
        patch.metrics = [{ label: 'Payload', value: raw.slice(0, 200) }];
      }
      handlers.onStatus(patch);
    });

    client.on('close', () => handlers.onConnectionChange(false, null));
    client.on('error', (err) => handlers.onConnectionChange(false, err.message));

    return client;
  },
};
