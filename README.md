# Bambu Status Checker

A super basic local web dashboard for monitoring the status of Bambu Lab
printers on your LAN. It connects directly to each printer's local MQTT
broker (LAN mode) and shows print state, progress, and other metrics in
a table. The MQTT layer is built around a device-type abstraction so
other MQTT devices can be added later without reworking the core.

## Why a web server instead of a browser extension

Bambu printers expose MQTT over TLS on port 8883 — raw TCP, not
WebSocket. Browser sandboxes (including Chrome extensions) can't open raw
TCP sockets, so a plain client-side extension can't talk to the printer
directly. A small Node.js server has no such restriction, so it does the
MQTT connection and serves a simple dashboard page over HTTP instead.

## Setup

1. On each printer: enable **LAN Only Mode** in network settings and note
   its **IP address**, **Access Code**, and **Serial Number** (all shown
   on the printer's network settings screen).
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open http://localhost:4101, pick a device type, and add your
   printer(s) using the form.

Device configuration (including access codes/passwords) is stored
locally in `printers.json`, which is gitignored — it's never committed.

## How it works

- `deviceTypes/` holds one module per device type (currently `bambu.js`
  and a `genericMqtt.js` fallback for arbitrary MQTT devices). Each
  module declares its connection fields (used to build the add/edit
  form) and a `connect(config, handlers)` function that opens the
  MQTT/TLS connection and reports status updates via `handlers.onStatus`
  / `handlers.onConnectionChange`.
- `server.js` is device-type agnostic: it stores per-device config, looks
  up the right module by `type`, and exposes a generic status shape
  (`state`, `detail`, `percent`, `remainingMinutes`, `metrics[]`) over a
  REST API — `GET /api/device-types`, `GET /api/printers`,
  `POST /api/printers`, `PUT /api/printers/:id`,
  `DELETE /api/printers/:id`.
- The dashboard (`public/`) fetches `GET /api/device-types` to build the
  add/edit form dynamically, then polls `GET /api/printers` every 3
  seconds and renders each device's row — no frontend changes are needed
  to support a new device type.

## Adding a new device type

Add a module to `deviceTypes/` exporting `{ id, label, fields, connect }`
(see `bambu.js` for the shape) and register it in `deviceTypes/index.js`.
The form and status table pick it up automatically.
