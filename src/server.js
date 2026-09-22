const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

const fs = require('fs');

// Ensure data directory exists for persistent device storage
const DATA_DIR = path.join(__dirname, '../data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

// Store device information and frames
// Map<deviceId, { id, model, manufacturer, osVersion, screenWidth, screenHeight, status, lastFrameTime, lastFrame }>
const devices = new Map();

// Track dashboard viewers
// Map<viewerWs, { watchedDeviceId: string | null }>
const dashboardViewers = new Map();

// Map<deviceId, ws> to route talkback audio to specific devices
const deviceSockets = new Map();

// Store in-memory device logs for live debugging
const deviceLogs = [];

// Load persisted devices from disk on startup so devices don't vanish on server restarts
function loadPersistedDevices() {
    try {
        if (fs.existsSync(DEVICES_FILE)) {
            const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                for (const d of list) {
                    // Mark previously saved devices as offline initially until they reconnect/ping
                    devices.set(d.id, { ...d, status: 'offline' });
                }
                console.log(`[STORAGE] Loaded ${list.length} persisted devices from disk`);
            }
        }
    } catch (e) {
        console.error('[STORAGE] Error loading persisted devices:', e);
    }
}

function savePersistedDevices() {
    try {
        const list = Array.from(devices.values()).map(d => {
            const { lastFrame, ...deviceInfo } = d;
            return deviceInfo;
        });
        fs.writeFileSync(DEVICES_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error('[STORAGE] Error saving persisted devices:', e);
    }
}

// Initialize persisted devices
loadPersistedDevices();

// --- HTTP Endpoints ---

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/debug-status', (req, res) => {
    const devList = Array.from(devices.values()).map(d => {
        const { lastFrame, ...rest } = d;
        return {
            ...rest,
            hasLastFrame: !!lastFrame,
            lastFrameSize: lastFrame ? lastFrame.length : 0
        };
    });
    res.json({
        devices: devList,
        logs: deviceLogs.slice(-50)
    });
});

app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.values()).map(d => {
        const { lastFrame, ...deviceInfo } = d; // Exclude binary frame for JSON response
        return deviceInfo;
    });
    res.json(deviceList);
});

// --- WebSocket Servers ---

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/screen-stream' || pathname === '/ws/dashboard') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, pathname);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws, request, pathname) => {
    if (pathname === '/ws/screen-stream') {
        handleDeviceConnection(ws);
    } else if (pathname === '/ws/dashboard') {
        handleDashboardConnection(ws);
    }
});

function broadcastDeviceList() {
    const deviceList = Array.from(devices.values()).map(d => {
        const { lastFrame, ...deviceInfo } = d;
        return deviceInfo;
    });
    
    const message = JSON.stringify({ type: 'device_list', devices: deviceList });
    for (const [viewerWs, _] of dashboardViewers.entries()) {
        if (viewerWs.readyState === WebSocket.OPEN) {
            viewerWs.send(message);
        }
    }
}

function handleDeviceConnection(ws) {
    let deviceId = uuidv4();
    console.log('[DEVICE WS] New device connection established');
    
    ws.on('message', (message, isBinary) => {
        if (!isBinary) {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'device_info') {
                    deviceId = data.deviceId || deviceId; // Use provided or generate new
                    deviceSockets.set(deviceId, ws);
                    
                    const existing = devices.get(deviceId) || {};
                    devices.set(deviceId, {
                        ...existing,
                        ...data,
                        id: deviceId,
                        status: 'online',
                        lastConnectTime: Date.now()
                    });
                    
                    savePersistedDevices();
                    // Notify dashboards about the new/updated device
                    broadcastDeviceList();
                    console.log(`[DEVICE WS] Device identified & saved: ${deviceId} (${data.model || 'Unknown'})`);
                } else if (data.type === 'ping') {
                    deviceId = data.deviceId || deviceId;
                    deviceSockets.set(deviceId, ws);

                    let device = devices.get(deviceId);
                    let shouldBroadcast = false;
                    if (!device) {
                        device = {
                            id: deviceId,
                            model: 'Honor / Android Device',
                            status: 'online',
                            lastConnectTime: Date.now()
                        };
                        devices.set(deviceId, device);
                        shouldBroadcast = true;
                    } else if (device.status !== 'online') {
                        device.status = 'online';
                        shouldBroadcast = true;
                    }
                    device.lastPingTime = Date.now();
                    savePersistedDevices();
                    if (shouldBroadcast) broadcastDeviceList();
                } else if (data.type === 'device_log') {
                    console.log(`[DEVICE LOG] [${data.tag}] ${data.message}`, data.error || '');
                    deviceLogs.push({ ...data, receivedAt: Date.now() });
                    if (deviceLogs.length > 200) deviceLogs.shift();
                    for (const [viewerWs, state] of dashboardViewers.entries()) {
                        if (state.watchedDeviceId === deviceId && viewerWs.readyState === WebSocket.OPEN) {
                            viewerWs.send(JSON.stringify(data));
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing device info/log:', e);
            }
        } else {
            // Binary message: 0x01 = Video frame, 0x02 = Audio chunk, or legacy raw JPEG
            let device = devices.get(deviceId);
            let shouldBroadcast = false;

            if (!device) {
                device = {
                    id: deviceId,
                    model: 'Honor / Android Device',
                    status: 'online',
                    lastConnectTime: Date.now()
                };
                devices.set(deviceId, device);
                deviceSockets.set(deviceId, ws);
                shouldBroadcast = true;
            } else if (device.status !== 'online') {
                device.status = 'online';
                shouldBroadcast = true;
            }

            const tag = message[0];
            if (tag === 0x01 || tag === 0xFF) { // Video frame
                device.lastFrame = message;
                device.lastFrameTime = Date.now();
            }
            
            if (shouldBroadcast) {
                savePersistedDevices();
                broadcastDeviceList();
            }

            // Broadcast binary packet directly to viewers currently watching this device
            for (const [viewerWs, state] of dashboardViewers.entries()) {
                if (state.watchedDeviceId === deviceId && viewerWs.readyState === WebSocket.OPEN) {
                    viewerWs.send(message);
                }
            }
        }
    });

    ws.on('close', () => {
        deviceSockets.delete(deviceId);
        const device = devices.get(deviceId);
        if (device) {
            device.status = 'offline';
            device.lastOfflineTime = Date.now();
            savePersistedDevices();
            broadcastDeviceList(); // Notify dashboards that device went offline
        }
        console.log(`[DEVICE WS] Device disconnected: ${deviceId}`);
    });
    
    ws.on('error', (err) => {
        console.error(`Device WS error (${deviceId}):`, err);
    });
}

function handleDashboardConnection(ws) {
    dashboardViewers.set(ws, { watchedDeviceId: null });
    
    // Send initial device list immediately upon connection
    const deviceList = Array.from(devices.values()).map(d => {
        const { lastFrame, ...deviceInfo } = d;
        return deviceInfo;
    });
    ws.send(JSON.stringify({ type: 'device_list', devices: deviceList }));

    ws.on('message', (message, isBinary) => {
        if (!isBinary) {
            try {
                const data = JSON.parse(message.toString());
                const state = dashboardViewers.get(ws);
                
                if (data.type === 'watch') {
                    state.watchedDeviceId = data.deviceId;
                    
                    // Immediately send the latest frame if available so it loads fast
                    const device = devices.get(data.deviceId);
                    if (device && device.lastFrame && ws.readyState === WebSocket.OPEN) {
                        ws.send(device.lastFrame);
                    }
                } else if (data.type === 'unwatch') {
                    state.watchedDeviceId = null;
                }
            } catch (e) {
                console.error('Error parsing dashboard message:', e);
            }
        } else {
            // Binary message from dashboard viewer:
            // 0x03 = Talkback audio from dashboard to phone speaker
            const state = dashboardViewers.get(ws);
            if (state && state.watchedDeviceId && message[0] === 0x03) {
                const targetDeviceWs = deviceSockets.get(state.watchedDeviceId);
                if (targetDeviceWs && targetDeviceWs.readyState === WebSocket.OPEN) {
                    targetDeviceWs.send(message);
                }
            }
        }
    });

    ws.on('close', () => {
        dashboardViewers.delete(ws);
    });
    
    ws.on('error', (err) => {
        console.error('Dashboard WS error:', err);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
