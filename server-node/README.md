# IoT Platform Server v2.0

A self-hosted IoT data platform for **Calliope Mini** with ESP WiFi extension. Collects sensor data, sends commands to devices, and provides a real-time dashboard with configurable feed widgets.

Built with Node.js/Express, SQLite, and optional MQTT bridging. No cloud dependency.

## Features

- **REST API** for sensor data ingestion and device commands
- **API key authentication** (bcrypt-hashed, generate via CLI or dashboard)
- **Feeds & Groups** - auto-created data streams with configurable widgets (value, gauge, sparkline)
- **Real-time dashboard** with sidebar navigation, feed configuration, and API key management
- **WebSocket** live updates to the dashboard
- **MQTT bridge** (optional) - bidirectional bridge to any MQTT broker
- **Security hardened** - Helmet headers, rate limiting, CORS control, input validation
- **Backward compatible** - existing Calliope/ESP devices work without firmware changes

## Architecture

```
Calliope Mini + ESP WiFi
        |
        | HTTP POST /api/sensor
        v
+--------------------+       +------------------+
|  IoT Platform      |<----->|  MQTT Broker     |
|  Server (Express)  |       |  (optional)      |
|                    |       +------------------+
|  - REST API        |
|  - WebSocket       |
|  - SQLite DB       |
|  - Feed system     |
+--------------------+
        |
        | http://localhost:5050
        v
+--------------------+
|  Dashboard (HTML)  |
|  - Feed widgets    |
|  - Device mgmt     |
|  - Settings/Keys   |
+--------------------+
```

## Quick Start

### 1. Install

```bash
cd server-node
npm install
```

### 2. Generate an API key

```bash
node server.js --generate-key "My First Key"
```

Save the printed key - it cannot be retrieved later.

### 3. Start the server

```bash
npm start
```

> **macOS note:** Port 5000 may be used by AirPlay. Use `PORT=5050 npm start` instead.

Or with auto-reload during development:
```bash
PORT=5050 npm run dev
```

### 4. Open the dashboard

Navigate to `http://localhost:5050` in your browser. Enter your API key in the orange banner to connect.

### 5. Send test data

```bash
curl -X POST http://localhost:5050/api/sensor \
  -H "Content-Type: application/json" \
  -H "X-AIO-Key: YOUR_API_KEY" \
  -d '{"device_id": "calliope01", "temperature": "23.5", "humidity": "62"}'
```

Feeds are auto-created. Open the dashboard to see live widgets.

## Configuration

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | HTTP server port |
| `DB_PATH` | `iot_data.db` | SQLite database file path |
| `CORS_ORIGINS` | *(empty = allow all)* | Comma-separated allowed origins |
| `MASTER_API_KEY` | *(empty)* | Fallback API key (useful for device transition) |
| `RATE_LIMIT_MAX` | `100` | API requests per 15-minute window |
| `RATE_LIMIT_SENSOR_MAX` | `500` | Sensor POST requests per 15-minute window |
| `MQTT_HOST` | *(empty = disabled)* | MQTT broker hostname (enables bridge) |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_USER` | *(empty)* | MQTT username |
| `MQTT_PASS` | *(empty)* | MQTT password |
| `MQTT_TOPIC_PREFIX` | `iot` | MQTT topic prefix (subscribes to `iot/+/+`) |

## API Key Management

### CLI

```bash
# Generate a new key
node server.js --generate-key "Key Name"

# List all keys
node server.js --list-keys

# Revoke a key by its prefix
node server.js --revoke-key 3e9d48d4
```

### Dashboard

Go to **Settings** in the sidebar to generate, view, and revoke keys through the UI.

### API

```bash
# Generate key (returns the key once)
curl -X POST http://localhost:5050/api/keys/generate \
  -H "X-AIO-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "ESP Device Key"}'

# List keys (no secrets shown)
curl http://localhost:5050/api/keys -H "X-AIO-Key: YOUR_KEY"

# Revoke key by id
curl -X DELETE http://localhost:5050/api/keys/3 -H "X-AIO-Key: YOUR_KEY"
```

## API Reference

All endpoints (except `GET /` and `GET /api/status`) require an API key via:
- Header: `X-AIO-Key: YOUR_KEY`
- Query param: `?key=YOUR_KEY`

**Bootstrap mode:** When no API keys exist yet, all endpoints are accessible without auth so you can set up through the dashboard.

### Sensor Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sensor` | Send sensor data (auto-creates feeds) |
| `GET` | `/api/sensor/:device_id` | Get latest readings for a device |
| `GET` | `/api/history/:device_id/:sensor_type` | Historical data (`?limit=100`) |
| `DELETE` | `/api/data/:device_id` | Delete all data for a device |

**POST /api/sensor** - the main endpoint for devices:

```json
{
  "device_id": "calliope01",
  "temperature": "23.5",
  "humidity": "62",
  "light": "450"
}
```

Each key-value pair (except `device_id`) becomes a separate sensor reading. If `device_id` is omitted, the client IP is used. Feeds are automatically created for each device + sensor type combination.

**Response:**
```json
{
  "status": "ok",
  "device_id": "calliope01",
  "records_stored": 3
}
```

### Commands

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/command` | Queue a command for a device |
| `GET` | `/api/command/:device_id` | Get next pending command (marks as executed) |

**POST /api/command:**
```json
{
  "device_id": "calliope01",
  "command": "led_on",
  "value": "red"
}
```

**GET /api/command/:device_id** returns compact JSON for IoT devices:
```json
{"command": "led_on", "value": "red"}
```

Returns `{"error": "none"}` (HTTP 404) when no commands are pending.

### Feeds

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/feeds` | List all feeds with last value |
| `GET` | `/api/feeds/:key` | Get feed details + recent data (`?limit=50`) |
| `PATCH` | `/api/feeds/:key` | Update feed config (name, units, widget, color) |
| `DELETE` | `/api/feeds/:key` | Delete feed and its data |
| `POST` | `/api/feeds/:key/data` | Send value to a feed (Adafruit IO compatible) |

**PATCH /api/feeds/:key** - configure how a feed appears on the dashboard:
```json
{
  "name": "Room Temperature",
  "unit_type": "Temperature",
  "unit_symbol": "C",
  "widget_type": "gauge",
  "color": "#e53e3e"
}
```

Widget types: `value` (large number), `gauge` (SVG arc), `sparkline` (mini chart).

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/groups` | List all groups with their feeds |
| `POST` | `/api/groups` | Create a group |
| `POST` | `/api/groups/:key/feeds` | Add a feed to a group |
| `DELETE` | `/api/groups/:key` | Delete a group (keeps feeds) |

### Server Info

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/` | No | Dashboard HTML |
| `GET` | `/api/status` | No | Server status and stats |
| `WS` | `/api/ws?key=YOUR_KEY` | Yes | WebSocket for live updates |

**GET /api/status** response:
```json
{
  "status": "ok",
  "server": "IoT Platform - Node.js",
  "version": "2.0.0",
  "uptime": 3600,
  "devices": 5,
  "total_data_points": 1250,
  "feeds": 12,
  "websocket_clients": 2,
  "mqtt": { "connected": true, "host": "broker.local" }
}
```

## WebSocket API

Connect to `ws://localhost:5050/api/ws?key=YOUR_KEY` for real-time sensor data updates.

**Message format (incoming):**
```json
{
  "type": "sensor_data",
  "device_id": "calliope01",
  "data": { "temperature": 25.3, "humidity": 60 },
  "timestamp": "2026-02-18T14:30:00.000Z"
}
```

## MQTT Bridge

When `MQTT_HOST` is set in `.env`, the server connects to the MQTT broker and:

1. **Subscribes** to `{prefix}/+/+` (e.g. `iot/calliope01/temperature`)
2. **Incoming** MQTT messages are stored in the database and broadcast to WebSocket clients
3. **Outgoing** sensor data received via HTTP is published to MQTT topics

Topic format: `iot/{device_id}/{sensor_type}`

This allows mixing HTTP devices (Calliope/ESP) with MQTT devices on the same platform.

## Usage Examples

### Calliope Mini (MakeCode)

Using the WiFi extension:

```typescript
// Connect to WiFi
WiFi.setupWifi("YourSSID", "YourPassword")

// Send sensor data with API key
WiFi.sendSensorData("192.168.1.100", 5050, "/api/sensor", "temperature", "25.3")
```

> **Tip:** If your firmware cannot easily add the `X-AIO-Key` header, set `MASTER_API_KEY` in your `.env` and configure the device to send that key as a query parameter: `/api/sensor?key=YOUR_MASTER_KEY`

### cURL Examples

```bash
# Send sensor data
curl -X POST http://localhost:5050/api/sensor \
  -H "Content-Type: application/json" \
  -H "X-AIO-Key: YOUR_KEY" \
  -d '{"device_id":"calliope01","temperature":"25.3","humidity":"60"}'

# Get device data
curl http://localhost:5050/api/sensor/calliope01 -H "X-AIO-Key: YOUR_KEY"

# Send command to device
curl -X POST http://localhost:5050/api/command \
  -H "Content-Type: application/json" \
  -H "X-AIO-Key: YOUR_KEY" \
  -d '{"device_id":"calliope01","command":"led_on","value":"red"}'

# Check for pending commands
curl http://localhost:5050/api/command/calliope01?key=YOUR_KEY

# Send data directly to a feed (Adafruit IO style)
curl -X POST http://localhost:5050/api/feeds/room_temperature/data \
  -H "Content-Type: application/json" \
  -H "X-AIO-Key: YOUR_KEY" \
  -d '{"value": 23.5}'

# Configure a feed widget
curl -X PATCH http://localhost:5050/api/feeds/calliope01_temperature \
  -H "Content-Type: application/json" \
  -H "X-AIO-Key: YOUR_KEY" \
  -d '{"name":"Room Temp","unit_symbol":"C","widget_type":"gauge"}'
```

### Python Client

```python
import requests

BASE = "http://localhost:5050"
HEADERS = {"X-AIO-Key": "YOUR_KEY", "Content-Type": "application/json"}

# Send sensor data
requests.post(f"{BASE}/api/sensor", json={
    "device_id": "calliope01",
    "temperature": "25.3",
    "humidity": "60"
}, headers=HEADERS)

# Get latest data
r = requests.get(f"{BASE}/api/sensor/calliope01", headers=HEADERS)
print(r.json())

# List all feeds
r = requests.get(f"{BASE}/api/feeds", headers=HEADERS)
for feed in r.json():
    print(f"{feed['key']}: {feed['last_value']}")
```

### Node.js Client

```javascript
const API_KEY = 'YOUR_KEY';

// Send sensor data
await fetch('http://localhost:5050/api/sensor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AIO-Key': API_KEY },
    body: JSON.stringify({ device_id: 'calliope01', temperature: '25.3' })
});

// WebSocket for live updates
const ws = new WebSocket('ws://localhost:5050/api/ws?key=' + API_KEY);
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Live:', data.device_id, data.data);
};
```

## Dashboard

The dashboard is a single HTML file with no build step and no external dependencies. It provides four pages:

- **Dashboard** - stats overview + feed widgets (value/gauge/sparkline)
- **Feeds** - list and configure all feeds (name, units, widget type, color)
- **Devices** - device cards with sensor readings + send commands form
- **Settings** - API key management (generate/revoke), server info, MQTT status

The API key is stored in `sessionStorage` (cleared when the browser tab closes).

## Database

The server uses SQLite with Write-Ahead Logging (WAL) for concurrent performance. Tables:

| Table | Purpose |
|-------|---------|
| `sensor_data` | Time-series sensor readings (with feed_id) |
| `feeds` | Feed metadata (name, units, widget config) |
| `groups_table` | Feed group definitions |
| `feed_group` | Feed-to-group associations |
| `devices` | Device registry (id, name, last_seen, IP) |
| `device_commands` | Command queue for devices |
| `api_keys` | API key hashes and metadata |

The database file is created automatically on first run.

To reset: `rm iot_data.db && npm start`

## Security

| Feature | Implementation |
|---------|---------------|
| Authentication | API keys with bcrypt hashing (10 rounds) |
| Key storage | Only bcrypt hash + 8-char prefix stored; full key shown once |
| Security headers | Helmet.js (X-Content-Type-Options, X-Frame-Options, etc.) |
| Rate limiting | express-rate-limit (configurable windows per endpoint) |
| CORS | Configurable allowed origins (via `CORS_ORIGINS` env var) |
| Input validation | Regex patterns for device IDs, sensor types; numeric value enforcement |
| WebSocket auth | Requires API key as query parameter |
| SQL injection | Parameterized queries throughout |
| Database | WAL mode, foreign keys enabled |

## Running Tests

```bash
# Generate a key first, then:
API_KEY=your_key BASE_URL=http://localhost:5050 npm test
```

The test suite runs 44 assertions covering auth, sensor data, feeds, commands, input validation, groups, and key management.

## Deployment

### Using PM2 (recommended)

```bash
npm install -g pm2
PORT=5050 pm2 start server.js --name iot-platform
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/iot-platform.service`:
```ini
[Unit]
Description=IoT Platform Server
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/server-node
ExecStart=/usr/bin/node server.js
Environment=PORT=5050
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable iot-platform
sudo systemctl start iot-platform
```

## Troubleshooting

**Port already in use:**
```bash
PORT=5050 npm start
```

**macOS port 5000 conflict (AirPlay):**
```bash
PORT=5050 npm start
```

**Database locked:**
- Ensure only one server instance is running
- Check file permissions on the `.db` file

**WebSocket connection fails:**
- Verify the API key is passed as query param: `ws://host/api/ws?key=YOUR_KEY`
- Check firewall settings
- If behind a reverse proxy, ensure WebSocket upgrade is supported

## Project Structure

```
server-node/
  server.js          Server: API endpoints, auth, feeds, MQTT bridge
  dashboard.html     Single-file dashboard (HTML + CSS + JS, no build step)
  package.json       Dependencies and npm scripts
  test-client.js     Automated test suite (44 assertions)
  .env.example       Configuration template
  .env               Your local configuration (create from .env.example)
  iot_data.db        SQLite database (auto-created on first run)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| express | Web framework |
| cors | Cross-origin resource sharing |
| sqlite3 | SQLite database driver |
| express-ws | WebSocket support |
| dotenv | Environment variable loading |
| bcryptjs | API key hashing (pure JS) |
| helmet | Security headers |
| express-rate-limit | Rate limiting |
| mqtt | MQTT client (optional bridge) |

## License

MIT

---

Made for Calliope Mini IoT Projects
