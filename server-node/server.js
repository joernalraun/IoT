#!/usr/bin/env node
/**
 * IoT Platform Server for Calliope Mini - Node.js/Express Implementation
 * v2.0 - With API key auth, feeds/groups, MQTT bridge, and enhanced dashboard
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const expressWs = require('express-ws');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// ==================== Configuration ====================

const PORT = process.env.PORT || 5000;
const DB_PATH = process.env.DB_PATH || 'iot_data.db';
const MASTER_API_KEY = process.env.MASTER_API_KEY || '';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// ==================== Security Headers ====================

app.use(helmet({
    contentSecurityPolicy: false,       // Dashboard uses inline scripts/styles
    crossOriginEmbedderPolicy: false
}));

// Disable unnecessary headers to reduce response size for IoT devices
app.disable('x-powered-by');
app.disable('etag');
app.set('jsonp callback', false);

// Middleware to remove Date header (saves ~40 bytes per response)
app.use((req, res, next) => {
    res.removeHeader = res.removeHeader || function() {};
    const oldEnd = res.end;
    res.end = function(...args) {
        res.removeHeader('Date');
        oldEnd.apply(res, args);
    };
    next();
});

const wsInstance = expressWs(app);

// ==================== CORS Configuration ====================

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (IoT devices, curl, mobile apps)
        if (!origin) return callback(null, true);
        // If no origins configured, allow all (dev mode)
        if (CORS_ORIGINS.length === 0) return callback(null, true);
        if (CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-AIO-Key'],
    credentials: true
}));

// ==================== Body Parsing ====================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== Rate Limiting ====================

const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    message: { status: 'error', message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/' || req.path === '/api/status'
});

const sensorLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_SENSOR_MAX) || 500,
    message: { status: 'error', message: 'Sensor rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/api/sensor', sensorLimiter);

// ==================== Database ====================

const db = new sqlite3.Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

function initDatabase() {
    db.serialize(() => {
        // Sensor data table
        db.run(`
            CREATE TABLE IF NOT EXISTS sensor_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                sensor_type TEXT NOT NULL,
                value REAL NOT NULL,
                feed_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Device commands table
        db.run(`
            CREATE TABLE IF NOT EXISTS device_commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                command TEXT NOT NULL,
                value TEXT,
                executed INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Device registry
        db.run(`
            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                name TEXT,
                last_seen DATETIME,
                ip_address TEXT
            )
        `);

        // API keys table
        db.run(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_hash TEXT NOT NULL,
                key_prefix TEXT NOT NULL,
                name TEXT NOT NULL,
                permissions TEXT DEFAULT 'all',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used DATETIME,
                active INTEGER DEFAULT 1
            )
        `);

        // Feeds table
        db.run(`
            CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                unit_type TEXT DEFAULT '',
                unit_symbol TEXT DEFAULT '',
                device_id TEXT,
                sensor_type TEXT,
                widget_type TEXT DEFAULT 'value',
                color TEXT DEFAULT '#667eea',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Groups table
        db.run(`
            CREATE TABLE IF NOT EXISTS groups_table (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Feed-Group junction table
        db.run(`
            CREATE TABLE IF NOT EXISTS feed_group (
                feed_id INTEGER NOT NULL,
                group_id INTEGER NOT NULL,
                PRIMARY KEY (feed_id, group_id),
                FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE
            )
        `);

        // Indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_sensor_device_timestamp
                 ON sensor_data(device_id, timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sensor_device_type
                 ON sensor_data(device_id, sensor_type, timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sensor_feed
                 ON sensor_data(feed_id, timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_commands_device_executed
                 ON device_commands(device_id, executed, timestamp ASC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_feeds_key ON feeds(key)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_feeds_device ON feeds(device_id, sensor_type)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_groups_key ON groups_table(key)`);

        // Migration: add feed_id column to sensor_data if missing
        db.all("PRAGMA table_info(sensor_data)", [], (err, columns) => {
            if (columns && !columns.some(col => col.name === 'feed_id')) {
                db.run('ALTER TABLE sensor_data ADD COLUMN feed_id INTEGER');
            }
        });

        console.log('Database initialized');
    });
}

initDatabase();

// ==================== Input Validation Helpers ====================

const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_.\-:]{1,64}$/;
const SENSOR_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const FEED_KEY_PATTERN = /^[a-z0-9_]{1,128}$/;

function validateDeviceId(id) {
    return id && DEVICE_ID_PATTERN.test(id);
}

function validateSensorType(type) {
    return type && SENSOR_TYPE_PATTERN.test(type);
}

// ==================== Authentication ====================

function authenticateApiKey(req, res, next) {
    // Exempt routes: dashboard and health check
    // Note: when mounted on /api, req.path is relative (e.g. /status not /api/status)
    if (req.path === '/' && req.method === 'GET') return next();
    if (req.path === '/status' && req.method === 'GET') return next();

    const providedKey = req.headers['x-aio-key'] || req.query.key;

    if (!providedKey) {
        return res.status(401).json({
            status: 'error',
            message: 'API key required. Send via X-AIO-Key header or ?key= query parameter.'
        });
    }

    // Check master key first (fast path)
    if (MASTER_API_KEY && providedKey === MASTER_API_KEY) {
        return next();
    }

    // Check database keys
    db.all('SELECT id, key_hash FROM api_keys WHERE active = 1', [], (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Authentication error' });

        if (!rows || rows.length === 0) {
            // No keys exist yet - allow access (first-run bootstrap)
            if (!MASTER_API_KEY) return next();
            return res.status(403).json({ status: 'error', message: 'Invalid API key' });
        }

        for (const row of rows) {
            if (bcrypt.compareSync(providedKey, row.key_hash)) {
                // Update last_used (fire and forget)
                db.run('UPDATE api_keys SET last_used = datetime("now") WHERE id = ?', [row.id]);
                return next();
            }
        }

        return res.status(403).json({ status: 'error', message: 'Invalid API key' });
    });
}

// Apply auth to all /api routes
app.use('/api', authenticateApiKey);

// ==================== Feed Helper ====================

function getOrCreateFeed(deviceId, sensorType, callback) {
    const feedKey = `${deviceId}_${sensorType}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    db.get('SELECT id FROM feeds WHERE key = ?', [feedKey], (err, row) => {
        if (err) return callback(err, null);
        if (row) return callback(null, row.id);

        const feedName = `${deviceId} - ${sensorType}`;
        db.run('INSERT OR IGNORE INTO feeds (key, name, device_id, sensor_type) VALUES (?, ?, ?, ?)',
            [feedKey, feedName, deviceId, sensorType], function(err) {
                if (err) {
                    // Race condition: try to fetch again
                    db.get('SELECT id FROM feeds WHERE key = ?', [feedKey], (err2, row2) => {
                        callback(null, row2 ? row2.id : null);
                    });
                } else {
                    callback(null, this.lastID);
                }
            });
    });
}

// ==================== WebSocket ====================

const wsClients = new Set();

function broadcastSensorData(deviceId, data) {
    const message = JSON.stringify({
        type: 'sensor_data',
        device_id: deviceId,
        data: data,
        timestamp: new Date().toISOString()
    });

    wsClients.forEach(ws => {
        if (ws.readyState === 1) { // OPEN
            ws.send(message);
        }
    });
}

// ==================== MQTT Bridge (Optional) ====================

const MQTT_HOST = process.env.MQTT_HOST;
let mqttClient = null;

if (MQTT_HOST) {
    const mqtt = require('mqtt');
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'iot';

    const mqttOptions = {
        port: parseInt(process.env.MQTT_PORT) || 1883,
        username: process.env.MQTT_USER || undefined,
        password: process.env.MQTT_PASS || undefined,
        clientId: `iot-platform-${Date.now()}`,
        reconnectPeriod: 5000,
    };

    mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}`, mqttOptions);

    mqttClient.on('connect', () => {
        console.log(`MQTT connected to ${MQTT_HOST}`);
        mqttClient.subscribe(`${topicPrefix}/+/+`, (err) => {
            if (err) console.error('MQTT subscribe error:', err);
            else console.log(`MQTT subscribed to ${topicPrefix}/+/+`);
        });
    });

    mqttClient.on('message', (topic, message) => {
        const parts = topic.split('/');
        if (parts.length < 3) return;

        const deviceId = parts[parts.length - 2];
        const sensorType = parts[parts.length - 1];
        const value = parseFloat(message.toString());

        if (isNaN(value) || !isFinite(value)) return;
        if (!validateDeviceId(deviceId)) return;
        if (!validateSensorType(sensorType)) return;

        // Update device registry
        db.run('INSERT OR REPLACE INTO devices (device_id, last_seen, ip_address) VALUES (?, datetime("now"), ?)',
            [deviceId, 'mqtt']);

        // Store with feed
        getOrCreateFeed(deviceId, sensorType, (err, feedId) => {
            db.run('INSERT INTO sensor_data (device_id, sensor_type, value, feed_id) VALUES (?, ?, ?, ?)',
                [deviceId, sensorType, value, feedId]);
            db.run('UPDATE feeds SET updated_at = datetime("now") WHERE id = ?', [feedId]);
        });

        // Broadcast to WebSocket clients
        broadcastSensorData(deviceId, { [sensorType]: value });
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.log('MQTT disconnected, will reconnect...');
    });
}

// Publish to MQTT helper
function publishToMqtt(deviceId, sensorData) {
    if (mqttClient && mqttClient.connected) {
        const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'iot';
        for (const [sensorType, value] of Object.entries(sensorData)) {
            mqttClient.publish(
                `${topicPrefix}/${deviceId}/${sensorType}`,
                String(value),
                { qos: 0, retain: true }
            );
        }
    }
}

// ==================== API Endpoints ====================

/**
 * Home - Serve Dashboard
 */
app.get('/', (req, res) => {
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.send('<h1>IoT Platform Server</h1><p>Dashboard file not found. See /api/status for server info.</p>');
    }
});

/**
 * Server Status (exempt from auth)
 */
app.get('/api/status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM devices', (err, deviceCount) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });

        db.get('SELECT COUNT(*) as count FROM sensor_data', (err, dataCount) => {
            if (err) return res.status(500).json({ status: 'error', message: err.message });

            db.get('SELECT COUNT(*) as count FROM feeds', (err, feedCount) => {
                if (err) return res.status(500).json({ status: 'error', message: err.message });

                res.json({
                    status: 'ok',
                    server: 'IoT Platform - Node.js',
                    version: '2.0.0',
                    uptime: process.uptime(),
                    devices: deviceCount.count,
                    total_data_points: dataCount.count,
                    feeds: feedCount.count,
                    websocket_clients: wsClients.size,
                    mqtt: mqttClient ? {
                        connected: mqttClient.connected,
                        host: MQTT_HOST
                    } : null
                });
            });
        });
    });
});

// ==================== Sensor Data Endpoints ====================

/**
 * POST /api/sensor - Receive sensor data from devices
 */
app.post('/api/sensor', (req, res) => {
    const data = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;
    const deviceId = data.device_id || clientIp;

    // Validate device_id
    if (data.device_id && !validateDeviceId(data.device_id)) {
        return res.status(400).json({ status: 'error', message: 'Invalid device_id format (alphanumeric, _.-: max 64 chars)' });
    }

    // Validate sensor entries
    const entries = Object.entries(data).filter(([key]) => key !== 'device_id');

    if (entries.length === 0) {
        return res.json({ status: 'ok', device_id: deviceId, records_stored: 0 });
    }

    for (const [key, value] of entries) {
        if (!validateSensorType(key)) {
            return res.status(400).json({ status: 'error', message: `Invalid sensor type: ${key} (must start with letter, alphanumeric/underscore, max 32 chars)` });
        }
        const numVal = parseFloat(value);
        if (isNaN(numVal) || !isFinite(numVal)) {
            return res.status(400).json({ status: 'error', message: `Invalid value for ${key}: must be a finite number` });
        }
    }

    // Update device registry
    db.run(`INSERT OR REPLACE INTO devices (device_id, last_seen, ip_address)
            VALUES (?, datetime('now'), ?)`, [deviceId, clientIp], (err) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        let storedCount = 0;
        const sensorData = {};
        let completed = 0;

        entries.forEach(([key, value], index) => {
            const numericValue = parseFloat(value) || 0;

            getOrCreateFeed(deviceId, key, (err, feedId) => {
                db.run(`INSERT INTO sensor_data (device_id, sensor_type, value, feed_id)
                        VALUES (?, ?, ?, ?)`, [deviceId, key, numericValue, feedId], (err) => {
                    if (err) {
                        console.error('Error inserting sensor data:', err);
                    } else {
                        sensorData[key] = numericValue;
                        storedCount++;
                        if (feedId) {
                            db.run('UPDATE feeds SET updated_at = datetime("now") WHERE id = ?', [feedId]);
                        }
                    }

                    completed++;
                    if (completed === entries.length) {
                        // Broadcast to WebSocket clients
                        broadcastSensorData(deviceId, sensorData);
                        // Publish to MQTT
                        publishToMqtt(deviceId, sensorData);

                        res.json({
                            status: 'ok',
                            device_id: deviceId,
                            records_stored: storedCount
                        });
                    }
                });
            });
        });
    });
});

/**
 * GET /api/sensor/:device_id - Get latest sensor data for a device
 */
app.get('/api/sensor/:device_id', (req, res) => {
    const { device_id } = req.params;

    db.all(`SELECT sensor_type, value, timestamp
            FROM sensor_data
            WHERE device_id = ?
            AND timestamp = (
                SELECT MAX(timestamp)
                FROM sensor_data AS sd2
                WHERE sd2.device_id = sensor_data.device_id
                AND sd2.sensor_type = sensor_data.sensor_type
            )`, [device_id], (err, results) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ status: 'no_data' });
        }

        const data = {};
        results.forEach(row => {
            data[row.sensor_type] = row.value;
        });
        data.timestamp = results[0].timestamp;

        res.json(data);
    });
});

// ==================== Command Endpoints ====================

/**
 * GET /api/command/:device_id - Get pending commands for a device
 */
app.get('/api/command/:device_id', (req, res) => {
    const { device_id } = req.params;

    // Remove CORS header for IoT devices (saves 33 bytes)
    res.removeHeader('Access-Control-Allow-Origin');

    db.get(`SELECT id, command, value
            FROM device_commands
            WHERE device_id = ? AND executed = 0
            ORDER BY timestamp ASC
            LIMIT 1`, [device_id], (err, result) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        if (result) {
            db.run('UPDATE device_commands SET executed = 1 WHERE id = ?', [result.id], (err) => {
                if (err) {
                    return res.status(400).json({ status: 'error', message: err.message });
                }
                res.set('Content-Type', 'application/json').send(`{"command":"${result.command}","value":"${result.value || ''}"}`);
            });
        } else {
            res.status(404).set('Content-Type', 'application/json').send('{"error":"none"}');
        }
    });
});

/**
 * POST /api/command - Send command to device
 */
app.post('/api/command', (req, res) => {
    const { device_id, command, value } = req.body;

    if (!device_id || !command) {
        return res.status(400).json({
            status: 'error',
            message: 'device_id and command required'
        });
    }

    if (!validateDeviceId(device_id)) {
        return res.status(400).json({ status: 'error', message: 'Invalid device_id format' });
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(command)) {
        return res.status(400).json({ status: 'error', message: 'Invalid command format' });
    }

    if (value && String(value).length > 256) {
        return res.status(400).json({ status: 'error', message: 'Command value too long (max 256 chars)' });
    }

    db.run(`INSERT INTO device_commands (device_id, command, value)
            VALUES (?, ?, ?)`, [device_id, command, value || ''], (err) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        res.json({
            status: 'ok',
            message: 'Command queued'
        });
    });
});

// ==================== Device Endpoints ====================

/**
 * GET /api/devices - Get list of all registered devices
 */
app.get('/api/devices', (req, res) => {
    db.all(`SELECT device_id, name, last_seen, ip_address
            FROM devices
            ORDER BY last_seen DESC`, [], (err, rows) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        const devices = rows.map(row => ({
            device_id: row.device_id,
            name: row.name || row.device_id,
            last_seen: row.last_seen,
            ip_address: row.ip_address
        }));

        res.json(devices);
    });
});

/**
 * GET /api/history/:device_id/:sensor_type - Get historical data
 */
app.get('/api/history/:device_id/:sensor_type', (req, res) => {
    const { device_id, sensor_type } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);

    db.all(`SELECT value, timestamp
            FROM sensor_data
            WHERE device_id = ? AND sensor_type = ?
            ORDER BY timestamp DESC
            LIMIT ?`, [device_id, sensor_type, limit], (err, rows) => {
        if (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        const data = rows.map(row => ({
            value: row.value,
            timestamp: row.timestamp
        }));

        res.json(data);
    });
});

/**
 * DELETE /api/data/:device_id - Delete all data for a device
 */
app.delete('/api/data/:device_id', (req, res) => {
    const { device_id } = req.params;

    if (!validateDeviceId(device_id)) {
        return res.status(400).json({ status: 'error', message: 'Invalid device_id format' });
    }

    db.serialize(() => {
        db.run('DELETE FROM sensor_data WHERE device_id = ?', [device_id]);
        db.run('DELETE FROM device_commands WHERE device_id = ?', [device_id]);
        db.run('DELETE FROM devices WHERE device_id = ?', [device_id], (err) => {
            if (err) {
                return res.status(400).json({ status: 'error', message: err.message });
            }

            res.json({
                status: 'ok',
                message: 'Device data deleted'
            });
        });
    });
});

// ==================== Feed Endpoints ====================

/**
 * GET /api/feeds - List all feeds with latest value
 */
app.get('/api/feeds', (req, res) => {
    db.all(`SELECT f.*,
            (SELECT sd.value FROM sensor_data sd WHERE sd.feed_id = f.id ORDER BY sd.timestamp DESC LIMIT 1) as last_value,
            (SELECT sd.timestamp FROM sensor_data sd WHERE sd.feed_id = f.id ORDER BY sd.timestamp DESC LIMIT 1) as last_updated
            FROM feeds f ORDER BY f.updated_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        res.json(rows);
    });
});

/**
 * GET /api/feeds/:key - Get single feed with recent data
 */
app.get('/api/feeds/:key', (req, res) => {
    const { key } = req.params;
    db.get('SELECT * FROM feeds WHERE key = ? OR id = ?', [key, parseInt(key) || 0], (err, feed) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        if (!feed) return res.status(404).json({ status: 'error', message: 'Feed not found' });

        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        db.all('SELECT id, value, timestamp FROM sensor_data WHERE feed_id = ? ORDER BY timestamp DESC LIMIT ?',
            [feed.id, limit], (err, data) => {
                feed.data = data || [];
                res.json(feed);
            });
    });
});

/**
 * PATCH /api/feeds/:key - Update feed metadata
 */
app.patch('/api/feeds/:key', (req, res) => {
    const { key } = req.params;
    const allowed = ['name', 'description', 'unit_type', 'unit_symbol', 'widget_type', 'color'];
    const updates = {};
    for (const field of allowed) {
        if (req.body[field] !== undefined) {
            if (typeof req.body[field] !== 'string' || req.body[field].length > 128) {
                return res.status(400).json({ status: 'error', message: `Invalid value for ${field}` });
            }
            updates[field] = req.body[field];
        }
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ status: 'error', message: 'No valid fields to update' });
    }
    updates.updated_at = new Date().toISOString();

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), key];

    db.run(`UPDATE feeds SET ${setClauses} WHERE key = ?`, values, function(err) {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        if (this.changes === 0) return res.status(404).json({ status: 'error', message: 'Feed not found' });
        res.json({ status: 'ok', message: 'Feed updated' });
    });
});

/**
 * DELETE /api/feeds/:key - Delete a feed and its data
 */
app.delete('/api/feeds/:key', (req, res) => {
    const { key } = req.params;
    db.get('SELECT id FROM feeds WHERE key = ?', [key], (err, feed) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        if (!feed) return res.status(404).json({ status: 'error', message: 'Feed not found' });
        db.serialize(() => {
            db.run('DELETE FROM sensor_data WHERE feed_id = ?', [feed.id]);
            db.run('DELETE FROM feed_group WHERE feed_id = ?', [feed.id]);
            db.run('DELETE FROM feeds WHERE id = ?', [feed.id], (err) => {
                if (err) return res.status(500).json({ status: 'error', message: err.message });
                res.json({ status: 'ok', message: 'Feed and data deleted' });
            });
        });
    });
});

/**
 * POST /api/feeds/:key/data - Adafruit IO compatible: send value to a feed
 */
app.post('/api/feeds/:key/data', (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
        return res.status(400).json({ status: 'error', message: 'value is required' });
    }

    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || !isFinite(numericValue)) {
        return res.status(400).json({ status: 'error', message: 'value must be a finite number' });
    }

    db.get('SELECT * FROM feeds WHERE key = ?', [key], (err, feed) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });

        if (!feed) {
            // Auto-create feed
            if (!FEED_KEY_PATTERN.test(key)) {
                return res.status(400).json({ status: 'error', message: 'Invalid feed key format' });
            }
            db.run('INSERT INTO feeds (key, name) VALUES (?, ?)', [key, key], function(err) {
                if (err) return res.status(500).json({ status: 'error', message: err.message });
                insertFeedData(this.lastID, key, numericValue, res);
            });
        } else {
            insertFeedData(feed.id, key, numericValue, res);
        }
    });
});

function insertFeedData(feedId, feedKey, value, res) {
    db.run('INSERT INTO sensor_data (device_id, sensor_type, value, feed_id) VALUES (?, ?, ?, ?)',
        ['api', feedKey, value, feedId], function(err) {
            if (err) return res.status(500).json({ status: 'error', message: err.message });
            db.run('UPDATE feeds SET updated_at = datetime("now") WHERE id = ?', [feedId]);

            // Broadcast to WebSocket
            broadcastSensorData('api', { [feedKey]: value });

            res.json({ status: 'ok', id: this.lastID, value: value });
        });
}

// ==================== Group Endpoints ====================

/**
 * GET /api/groups - List all groups with their feeds
 */
app.get('/api/groups', (req, res) => {
    db.all('SELECT * FROM groups_table ORDER BY name', [], (err, groups) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });

        if (groups.length === 0) return res.json([]);

        let pending = groups.length;
        const result = [];

        groups.forEach(group => {
            db.all(`SELECT f.* FROM feeds f
                    JOIN feed_group fg ON f.id = fg.feed_id
                    WHERE fg.group_id = ?`, [group.id], (err, feeds) => {
                group.feeds = feeds || [];
                result.push(group);
                if (--pending === 0) res.json(result);
            });
        });
    });
});

/**
 * POST /api/groups - Create a group
 */
app.post('/api/groups', (req, res) => {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.length > 128) {
        return res.status(400).json({ status: 'error', message: 'Valid name required (max 128 chars)' });
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 128);
    db.run('INSERT INTO groups_table (key, name, description) VALUES (?, ?, ?)',
        [key, name, description || ''], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ status: 'error', message: 'Group key already exists' });
                }
                return res.status(500).json({ status: 'error', message: err.message });
            }
            res.json({ status: 'ok', id: this.lastID, key });
        });
});

/**
 * POST /api/groups/:key/feeds - Add a feed to a group
 */
app.post('/api/groups/:key/feeds', (req, res) => {
    const { feed_key } = req.body;
    if (!feed_key) return res.status(400).json({ status: 'error', message: 'feed_key required' });

    db.get('SELECT id FROM groups_table WHERE key = ?', [req.params.key], (err, group) => {
        if (!group) return res.status(404).json({ status: 'error', message: 'Group not found' });
        db.get('SELECT id FROM feeds WHERE key = ?', [feed_key], (err, feed) => {
            if (!feed) return res.status(404).json({ status: 'error', message: 'Feed not found' });
            db.run('INSERT OR IGNORE INTO feed_group (feed_id, group_id) VALUES (?, ?)',
                [feed.id, group.id], (err) => {
                    if (err) return res.status(500).json({ status: 'error', message: err.message });
                    res.json({ status: 'ok', message: 'Feed added to group' });
                });
        });
    });
});

/**
 * DELETE /api/groups/:key - Delete a group (not its feeds)
 */
app.delete('/api/groups/:key', (req, res) => {
    db.get('SELECT id FROM groups_table WHERE key = ?', [req.params.key], (err, group) => {
        if (!group) return res.status(404).json({ status: 'error', message: 'Group not found' });
        db.serialize(() => {
            db.run('DELETE FROM feed_group WHERE group_id = ?', [group.id]);
            db.run('DELETE FROM groups_table WHERE id = ?', [group.id], (err) => {
                if (err) return res.status(500).json({ status: 'error', message: err.message });
                res.json({ status: 'ok', message: 'Group deleted' });
            });
        });
    });
});

// ==================== API Key Management Endpoints ====================

/**
 * POST /api/keys/generate - Generate a new API key
 */
app.post('/api/keys/generate', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.length > 64) {
        return res.status(400).json({ status: 'error', message: 'Key name required (max 64 chars)' });
    }

    const rawKey = crypto.randomBytes(32).toString('hex');
    const prefix = rawKey.substring(0, 8);
    const hash = bcrypt.hashSync(rawKey, 10);

    db.run('INSERT INTO api_keys (key_hash, key_prefix, name) VALUES (?, ?, ?)',
        [hash, prefix, name], function(err) {
            if (err) return res.status(500).json({ status: 'error', message: err.message });
            res.json({
                status: 'ok',
                key: rawKey,
                name: name,
                prefix: prefix,
                id: this.lastID,
                message: 'Save this key now - it cannot be retrieved later'
            });
        });
});

/**
 * GET /api/keys - List all API keys (no hashes)
 */
app.get('/api/keys', (req, res) => {
    db.all('SELECT id, key_prefix, name, permissions, created_at, last_used, active FROM api_keys ORDER BY created_at DESC',
        [], (err, rows) => {
            if (err) return res.status(500).json({ status: 'error', message: err.message });
            res.json(rows);
        });
});

/**
 * DELETE /api/keys/:id - Revoke an API key
 */
app.delete('/api/keys/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ status: 'error', message: 'Valid key ID required' });

    db.run('UPDATE api_keys SET active = 0 WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        if (this.changes === 0) return res.status(404).json({ status: 'error', message: 'Key not found' });
        res.json({ status: 'ok', message: 'API key revoked' });
    });
});

// ==================== WebSocket Endpoint ====================

app.ws('/api/ws', (ws, req) => {
    // Authenticate WebSocket connection
    const providedKey = req.query.key;

    // Check if auth is required
    const authRequired = !!MASTER_API_KEY;

    if (authRequired && !providedKey) {
        ws.close(4001, 'API key required: connect with ?key=YOUR_KEY');
        return;
    }

    if (authRequired && providedKey) {
        // Check master key
        if (MASTER_API_KEY && providedKey === MASTER_API_KEY) {
            // OK
        } else {
            // Check DB keys synchronously would block, so we do async validation
            db.all('SELECT key_hash FROM api_keys WHERE active = 1', [], (err, rows) => {
                if (err || !rows) {
                    ws.close(4003, 'Authentication error');
                    return;
                }
                const matched = rows.some(row => bcrypt.compareSync(providedKey, row.key_hash));
                if (!matched) {
                    ws.close(4003, 'Invalid API key');
                    return;
                }
            });
        }
    }

    console.log('WebSocket client connected');
    wsClients.add(ws);

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            console.log('WebSocket received:', data);
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        wsClients.delete(ws);
    });

    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to IoT Platform WebSocket'
    }));
});

// ==================== Error Handling ====================

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        status: 'error',
        message: 'Internal server error'
    });
});

// ==================== CLI Commands ====================

function runCLI() {
    const args = process.argv.slice(2);

    if (args.includes('--generate-key')) {
        const nameIndex = args.indexOf('--generate-key') + 1;
        const keyName = args[nameIndex] || 'Default';

        const rawKey = crypto.randomBytes(32).toString('hex');
        const prefix = rawKey.substring(0, 8);
        const hash = bcrypt.hashSync(rawKey, 10);

        db.run('INSERT INTO api_keys (key_hash, key_prefix, name) VALUES (?, ?, ?)',
            [hash, prefix, keyName], (err) => {
                if (err) {
                    console.error('Error generating key:', err.message);
                    db.close();
                    process.exit(1);
                }
                console.log(`\n  API Key generated successfully!`);
                console.log(`  Name:   ${keyName}`);
                console.log(`  Key:    ${rawKey}`);
                console.log(`  Prefix: ${prefix}...`);
                console.log(`\n  Save this key - it cannot be retrieved later.\n`);
                db.close();
                process.exit(0);
            });
        return true;
    }

    if (args.includes('--list-keys')) {
        db.all('SELECT id, key_prefix, name, permissions, created_at, last_used, active FROM api_keys ORDER BY created_at DESC',
            [], (err, rows) => {
                if (err) {
                    console.error('Error:', err.message);
                    db.close();
                    process.exit(1);
                }
                if (rows.length === 0) {
                    console.log('\n  No API keys found. Generate one with: node server.js --generate-key "Name"\n');
                } else {
                    console.log(`\n  API Keys (${rows.length}):`);
                    console.log('  ' + '-'.repeat(80));
                    rows.forEach(row => {
                        const status = row.active ? 'ACTIVE' : 'REVOKED';
                        const lastUsed = row.last_used || 'never';
                        console.log(`  [${row.key_prefix}...]  ${row.name.padEnd(20)} ${status.padEnd(8)} Last used: ${lastUsed}`);
                    });
                    console.log();
                }
                db.close();
                process.exit(0);
            });
        return true;
    }

    if (args.includes('--revoke-key')) {
        const prefixIndex = args.indexOf('--revoke-key') + 1;
        const prefix = args[prefixIndex];
        if (!prefix) {
            console.error('  Usage: node server.js --revoke-key <prefix>');
            process.exit(1);
        }
        db.run('UPDATE api_keys SET active = 0 WHERE key_prefix = ? AND active = 1', [prefix], function(err) {
            if (err) {
                console.error('Error:', err.message);
                db.close();
                process.exit(1);
            }
            if (this.changes === 0) {
                console.log(`\n  No active key found with prefix: ${prefix}\n`);
            } else {
                console.log(`\n  Key with prefix ${prefix} has been revoked.\n`);
            }
            db.close();
            process.exit(0);
        });
        return true;
    }

    return false;
}

// Run CLI commands or start server
// Use setTimeout to ensure DB tables are created first
setTimeout(() => {
    if (!runCLI()) {
        // Start HTTP server
        app.listen(PORT, () => {
            console.log(`
+------------------------------------------------------------+
|         IoT Platform Server v2.0 - Node.js/Express         |
|                                                            |
|  Server:    http://localhost:${String(PORT).padEnd(5)}                       |
|  WebSocket: ws://localhost:${String(PORT).padEnd(5)}/api/ws                  |
|  Dashboard: http://localhost:${String(PORT).padEnd(5)}                       |
|  MQTT:      ${mqttClient ? `connected to ${MQTT_HOST}` : 'not configured'}${' '.repeat(Math.max(0, 33 - (mqttClient ? `connected to ${MQTT_HOST}`.length : 'not configured'.length)))}|
|                                                            |
|  Security:  API key auth ${MASTER_API_KEY ? '(master key set)' : '(generate keys)'}${' '.repeat(Math.max(0, 22 - (MASTER_API_KEY ? '(master key set)' : '(generate keys)').length))}|
|                                                            |
|  CLI Commands:                                             |
|    --generate-key "Name"  Generate new API key             |
|    --list-keys            List all API keys                |
|    --revoke-key <prefix>  Revoke an API key                |
+------------------------------------------------------------+
            `);
        });
    }
}, 500);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    if (mqttClient) mqttClient.end();
    db.close();
    process.exit(0);
});
