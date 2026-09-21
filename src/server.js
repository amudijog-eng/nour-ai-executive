const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Store device information and frames
// Map<deviceId, { id, model, manufacturer, osVersion, screenWidth, screenHeight, status, lastFrameTime, lastFrame }>
const devices = new Map();

// Track dashboard viewers
// Map<viewerWs, { watchedDeviceId: string | null }>
const dashboardViewers = new Map();

// --- HTTP Endpoints ---

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
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
    
    ws.on('message', (message, isBinary) => {
        if (!isBinary) {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'device_info') {
                    deviceId = data.deviceId || deviceId; // Use provided or generate new
                    
                    const existing = devices.get(deviceId) || {};
                    devices.set(deviceId, {
                        ...existing,
                        id: deviceId,
                        model: data.model || 'Unknown',
                        manufacturer: data.manufacturer || 'Unknown',
                        osVersion: data.osVersion || 'Unknown',
                        screenWidth: data.screenWidth || 0,
                        screenHeight: data.screenHeight || 0,
                        status: 'online',
                        lastConnectTime: Date.now()
                    });
                    
                    // Notify dashboards about the new/updated device
                    broadcastDeviceList();
                }
            } catch (e) {
                console.error('Error parsing device info:', e);
            }
        } else {
            // Binary message = JPEG frame
            const device = devices.get(deviceId);
            if (device) {
                device.lastFrame = message;
                device.lastFrameTime = Date.now();
                
                // Broadcast frame to viewers currently watching this device
                for (const [viewerWs, state] of dashboardViewers.entries()) {
                    if (state.watchedDeviceId === deviceId && viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(message); // Forward binary frame directly
                    }
                }
            }
        }
    });

    ws.on('close', () => {
        const device = devices.get(deviceId);
        if (device) {
            device.status = 'offline';
            broadcastDeviceList(); // Notify dashboards that device went offline
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
