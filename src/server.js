const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const fs = require('fs');

// Ensure data directory exists for persistent device storage
const DATA_DIR = path.join(__dirname, '../data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');

if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
if (!fs.existsSync(RECORDINGS_DIR)) {
    try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch (e) {}
}

// Track DVR frame saving rate (1 snapshot every 2 seconds per device)
const lastSavedDvrTime = new Map();

function saveDvrFrame(deviceId, frameBuffer) {
    try {
        const now = Date.now();
        const last = lastSavedDvrTime.get(deviceId) || 0;
        if (now - last < 2000) return; // 1 frame every 2s to conserve disk
        lastSavedDvrTime.set(deviceId, now);

        const d = new Date(now);
        const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
        const hourStr = String(d.getHours()).padStart(2, '0');
        const minStr = String(d.getMinutes()).padStart(2, '0');
        const secStr = String(d.getSeconds()).padStart(2, '0');
        const timeStr = `${hourStr}:${minStr}:${secStr}`;

        const devDir = path.join(RECORDINGS_DIR, deviceId, dateStr);
        if (!fs.existsSync(devDir)) {
            fs.mkdirSync(devDir, { recursive: true });
        }

        let jpegData = frameBuffer;
        if (frameBuffer[0] === 0x01) {
            jpegData = frameBuffer.subarray(1);
        }

        const fileName = `${now}.jpg`;
        const filePath = path.join(devDir, fileName);
        fs.writeFileSync(filePath, jpegData);

        const indexFile = path.join(devDir, 'index.json');
        let indexList = [];
        if (fs.existsSync(indexFile)) {
            try { indexList = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (_) {}
        }
        indexList.push({
            timestamp: now,
            time: timeStr,
            hour: d.getHours(),
            minute: d.getMinutes(),
            file: fileName
        });
        // Limit to max 1500 frames per day to maintain stable disk space
        if (indexList.length > 1500) {
            const old = indexList.shift();
            try { fs.unlinkSync(path.join(devDir, old.file)); } catch (_) {}
        }
        fs.writeFileSync(indexFile, JSON.stringify(indexList));
    } catch (e) {
        console.error('[DVR ERROR]', e.message);
    }
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

app.post('/api/disconnect-report', (req, res) => {
    const { deviceId, reason, battery, networkType } = req.body;
    if (deviceId) {
        let device = devices.get(deviceId);
        if (!device) {
            device = { id: deviceId, model: 'Android Device' };
            devices.set(deviceId, device);
        }
        device.status = 'offline';
        device.disconnectReason = reason || 'إيقاف تشغيل الجهاز';
        device.batteryAtDisconnect = battery;
        device.networkAtDisconnect = networkType;
        device.lastOfflineTime = Date.now();
        device.lastReportTime = Date.now();

        device.disconnectHistory = device.disconnectHistory || [];
        device.disconnectHistory.push({
            reason: device.disconnectReason,
            battery,
            networkType,
            time: Date.now()
        });
        if (device.disconnectHistory.length > 20) device.disconnectHistory.shift();

        savePersistedDevices();
        broadcastDeviceList();
        console.log(`[DISCONNECT REPORT] Device ${deviceId}: ${reason} (Battery: ${battery}%)`);
    }
    res.json({ status: 'ok' });
});

// DVR API: Get available recording dates for a device
app.get('/api/recordings/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const devDir = path.join(RECORDINGS_DIR, deviceId);
    if (!fs.existsSync(devDir)) {
        return res.json({ dates: [] });
    }
    try {
        const dates = fs.readdirSync(devDir).filter(name => {
            try { return fs.statSync(path.join(devDir, name)).isDirectory(); } catch (_) { return false; }
        }).sort().reverse();
        res.json({ dates });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DVR API: Get frames timeline for a specific date
app.get('/api/recordings/:deviceId/:date', (req, res) => {
    const { deviceId, date } = req.params;
    const safeDate = path.basename(date);
    const indexFile = path.join(RECORDINGS_DIR, deviceId, safeDate, 'index.json');
    if (!fs.existsSync(indexFile)) {
        return res.json({ date: safeDate, count: 0, frames: [] });
    }
    try {
        const frames = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        res.json({ date: safeDate, count: frames.length, frames });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DVR API: Serve specific frame image
app.get('/api/recordings/:deviceId/:date/:filename', (req, res) => {
    const { deviceId, date, filename } = req.params;
    const safeDate = path.basename(date);
    const safeFile = path.basename(filename);
    const filePath = path.join(RECORDINGS_DIR, deviceId, safeDate, safeFile);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(filePath);
    } else {
        res.status(404).send('Frame not found');
    }
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
                } else if (data.type === 'disconnect_reason') {
                    deviceId = data.deviceId || deviceId;
                    let device = devices.get(deviceId);
                    if (device) {
                        device.disconnectReason = data.reason;
                        device.batteryAtDisconnect = data.battery;
                        device.networkAtDisconnect = data.networkType;
                        device.lastReportTime = Date.now();
                        device.status = 'offline';
                        device.disconnectHistory = device.disconnectHistory || [];
                        device.disconnectHistory.push({
                            reason: data.reason,
                            battery: data.battery,
                            networkType: data.networkType,
                            time: Date.now()
                        });
                        if (device.disconnectHistory.length > 20) device.disconnectHistory.shift();
                        savePersistedDevices();
                        broadcastDeviceList();
                        console.log(`[DISCONNECT WS] Device ${deviceId}: ${data.reason}`);
                    }
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
                saveDvrFrame(deviceId, message);
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
            const now = Date.now();
            if (!device.lastReportTime || (now - device.lastReportTime > 15000)) {
                if (device.lastPingTime && (now - device.lastPingTime > 40000)) {
                    device.disconnectReason = "انقطاع شبكة الإنترنت (Wi-Fi / البيانات)";
                } else {
                    device.disconnectReason = "إغلاق التطبيق أو توقف مفاجئ للخدمة";
                }
            }
            device.lastOfflineTime = now;
            device.disconnectHistory = device.disconnectHistory || [];
            device.disconnectHistory.push({
                reason: device.disconnectReason,
                time: now
            });
            if (device.disconnectHistory.length > 20) device.disconnectHistory.shift();

            savePersistedDevices();
            broadcastDeviceList(); // Notify dashboards that device went offline
            console.log(`[DEVICE WS] Device disconnected: ${deviceId} (${device.disconnectReason})`);
        }
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
