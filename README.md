# Bambu Status Checker

A super basic local web dashboard for monitoring the status of Bambu Lab
printers on your LAN. It connects directly to each printer's local MQTT
broker (LAN mode) and shows print state, progress, temperatures, and
remaining time.

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
4. Open http://localhost:3000 and add your printer(s) using the form.

Printer configuration (including access codes) is stored locally in
`printers.json`, which is gitignored — it's never committed.

## How it works

- `server.js` runs an Express server. For each configured printer it opens
  an MQTT/TLS connection (`mqtts://<printer-ip>:8883`, user `bblp`,
  password = access code), subscribes to `device/<serial>/report`, and
  caches the latest status in memory.
- The dashboard (`public/`) polls `GET /api/printers` every 3 seconds and
  renders each printer's state, progress, temperatures, and job info.
- Adding a printer posts to `POST /api/printers`; removing one calls
  `DELETE /api/printers/:id`.
