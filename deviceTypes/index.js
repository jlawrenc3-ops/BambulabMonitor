const bambu = require('./bambu');
const genericMqtt = require('./genericMqtt');

const registry = {
  [bambu.id]: bambu,
  [genericMqtt.id]: genericMqtt,
};

module.exports = registry;
