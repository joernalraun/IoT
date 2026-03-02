#!/usr/bin/env node
/**
 * Test client to verify IoT Platform Server v2.0 functionality
 *
 * Usage:
 *   API_KEY=your_key node test-client.js
 *   API_KEY=your_key BASE_URL=http://localhost:5000 node test-client.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const API_KEY = process.env.API_KEY || '';
const DEVICE_ID = 'TestDevice001';

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (API_KEY) options.headers['X-AIO-Key'] = API_KEY;

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function testServer() {
    console.log('Testing IoT Platform Server v2.0...');
    console.log('URL: ' + BASE_URL);
    console.log('API Key: ' + (API_KEY ? API_KEY.substring(0, 8) + '...' : '(none)'));
    console.log('');

    let passed = 0;
    let failed = 0;

    function assert(name, condition) {
        if (condition) {
            console.log('  PASS  ' + name);
            passed++;
        } else {
            console.log('  FAIL  ' + name);
            failed++;
        }
    }

    try {
        // Test 1: Server Status (exempt from auth)
        console.log('--- Server Status ---');
        const status = await request('GET', '/api/status');
        assert('Status endpoint returns 200', status.status === 200);
        assert('Status returns ok', status.data.status === 'ok');
        assert('Version is 2.0.0', status.data.version === '2.0.0');
        assert('Has feeds count', typeof status.data.feeds === 'number');
        console.log('');

        // Test 2: Auth rejection (without key)
        if (API_KEY) {
            console.log('--- Authentication ---');
            const noKeyReq = await new Promise((resolve, reject) => {
                const url = new URL('/api/devices', BASE_URL);
                const lib = url.protocol === 'https:' ? https : http;
                const req = lib.request({
                    hostname: url.hostname, port: url.port,
                    path: url.pathname, method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ status: res.statusCode }));
                });
                req.on('error', reject);
                req.end();
            });
            assert('Request without key returns 401 or 403', noKeyReq.status === 401 || noKeyReq.status === 403);
            console.log('');
        }

        // Test 3: Send Sensor Data
        console.log('--- Sensor Data ---');
        const sensorData = {
            device_id: DEVICE_ID,
            temperature: (20 + Math.random() * 10).toFixed(1),
            humidity: (50 + Math.random() * 20).toFixed(1),
            light: Math.floor(Math.random() * 1000)
        };
        const sendRes = await request('POST', '/api/sensor', sensorData);
        assert('Sensor POST returns 200', sendRes.status === 200);
        assert('Sensor POST status ok', sendRes.data.status === 'ok');
        assert('Records stored = 3', sendRes.data.records_stored === 3);
        console.log('');

        // Wait for data to settle
        await new Promise(r => setTimeout(r, 500));

        // Test 4: Get Sensor Data
        console.log('--- Get Sensor Data ---');
        const getRes = await request('GET', '/api/sensor/' + DEVICE_ID);
        assert('Sensor GET returns 200', getRes.status === 200);
        assert('Has temperature', typeof getRes.data.temperature === 'number');
        console.log('');

        // Test 5: Feeds (auto-created from sensor data)
        console.log('--- Feeds ---');
        const feedsRes = await request('GET', '/api/feeds');
        assert('Feeds endpoint returns 200', feedsRes.status === 200);
        assert('Feeds is an array', Array.isArray(feedsRes.data));
        assert('At least 3 feeds created', feedsRes.data.length >= 3);

        const tempFeed = feedsRes.data.find(f => f.key.includes('temperature'));
        assert('Temperature feed exists', !!tempFeed);
        if (tempFeed) {
            assert('Feed has last_value', tempFeed.last_value !== null);
            assert('Feed has device_id', !!tempFeed.device_id);
        }
        console.log('');

        // Test 6: Feed Config Update
        if (tempFeed) {
            console.log('--- Feed Config ---');
            const patchRes = await request('PATCH', '/api/feeds/' + tempFeed.key, {
                name: 'Room Temperature',
                unit_symbol: 'C',
                widget_type: 'gauge',
                color: '#e53e3e'
            });
            assert('Feed PATCH returns 200', patchRes.status === 200);
            assert('Feed PATCH status ok', patchRes.data.status === 'ok');

            const feedDetail = await request('GET', '/api/feeds/' + tempFeed.key);
            assert('Feed name updated', feedDetail.data.name === 'Room Temperature');
            assert('Feed unit_symbol updated', feedDetail.data.unit_symbol === 'C');
            assert('Feed widget_type updated', feedDetail.data.widget_type === 'gauge');
            assert('Feed has data array', Array.isArray(feedDetail.data.data));
            console.log('');
        }

        // Test 7: Adafruit IO compatible data send
        console.log('--- Feed Data Send (AIO compat) ---');
        const aioRes = await request('POST', '/api/feeds/test_manual_feed/data', { value: 42.5 });
        assert('Feed data POST returns 200', aioRes.status === 200);
        assert('Feed data POST has value', aioRes.data.value === 42.5);
        console.log('');

        // Test 8: Commands
        console.log('--- Commands ---');
        const cmdSend = await request('POST', '/api/command', {
            device_id: DEVICE_ID,
            command: 'led_on',
            value: 'blue'
        });
        assert('Command POST returns 200', cmdSend.status === 200);

        const cmdGet = await request('GET', '/api/command/' + DEVICE_ID);
        assert('Command GET returns 200', cmdGet.status === 200);
        assert('Command is led_on', cmdGet.data.command === 'led_on');
        assert('Command value is blue', cmdGet.data.value === 'blue');
        console.log('');

        // Test 9: Devices
        console.log('--- Devices ---');
        const devRes = await request('GET', '/api/devices');
        assert('Devices returns 200', devRes.status === 200);
        assert('Has at least 1 device', devRes.data.length >= 1);
        assert('Test device found', devRes.data.some(d => d.device_id === DEVICE_ID));
        console.log('');

        // Test 10: History
        console.log('--- History ---');
        const histRes = await request('GET', '/api/history/' + DEVICE_ID + '/temperature?limit=5');
        assert('History returns 200', histRes.status === 200);
        assert('History has records', histRes.data.length > 0);
        console.log('');

        // Test 11: Input Validation
        console.log('--- Input Validation ---');
        const badDevice = await request('POST', '/api/sensor', { device_id: '<script>alert(1)</script>', temperature: '25' });
        assert('Invalid device_id rejected', badDevice.status === 400);

        const badSensor = await request('POST', '/api/sensor', { device_id: 'ValidDevice', '123invalid': '25' });
        assert('Invalid sensor type rejected', badSensor.status === 400);

        const badValue = await request('POST', '/api/sensor', { device_id: 'ValidDevice', temperature: 'not_a_number' });
        assert('Non-numeric value rejected', badValue.status === 400);
        console.log('');

        // Test 12: Groups
        console.log('--- Groups ---');
        const grpCreate = await request('POST', '/api/groups', { name: 'Test Group', description: 'Test' });
        assert('Group creation returns 200', grpCreate.status === 200);

        const grpList = await request('GET', '/api/groups');
        assert('Groups list returns 200', grpList.status === 200);
        assert('Groups is an array', Array.isArray(grpList.data));
        console.log('');

        // Test 13: API Key Management
        if (API_KEY) {
            console.log('--- API Key Management ---');
            const keysRes = await request('GET', '/api/keys');
            assert('Keys list returns 200', keysRes.status === 200);
            assert('Keys is an array', Array.isArray(keysRes.data));

            const genRes = await request('POST', '/api/keys/generate', { name: 'Test Generated Key' });
            assert('Key generation returns 200', genRes.status === 200);
            assert('Generated key returned', genRes.data.key && genRes.data.key.length === 64);

            if (genRes.data.id) {
                const revokeRes = await request('DELETE', '/api/keys/' + genRes.data.id);
                assert('Key revocation returns 200', revokeRes.status === 200);
            }
            console.log('');
        }

        // Summary
        console.log('========================================');
        console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
        console.log('========================================');

        if (failed > 0) process.exit(1);

    } catch (error) {
        console.error('Test error:', error.message);
        process.exit(1);
    }
}

testServer();
