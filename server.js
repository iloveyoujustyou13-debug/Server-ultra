const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CBP Ultimate Cloud Routing Engine v7.0.0 is Running Perfectly!\n');
});

const wss = new WebSocket.Server({ server });

let activeBroadcastRooms = {}; 
let activeMonitorTokens = {};  

function generateShortRoomCode() {
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'CBP-';
    for (let i = 0; i < 5; i++) {
        code += pool.charAt(Math.floor(Math.random() * pool.length));
    }
    return code;
}

wss.on('connection', (ws) => {
    ws.nodeId = null;
    ws.roomCode = null;
    ws.nodeRole = null;
    ws.assignedMonitorToken = null;

    ws.on('message', (message) => {
        let packet;
        try { packet = JSON.parse(message); } catch (e) { return; }

        switch (packet.type) {
            case 'create_room':
                const newCode = generateShortRoomCode();
                ws.nodeId = 'director_' + Math.random().toString(36).substr(2, 9);
                ws.roomCode = newCode;
                ws.nodeRole = 'director';
                activeBroadcastRooms[newCode] = { directorSocket: ws, connectedCameras: {} };
                ws.send(JSON.stringify({ type: 'room_created', roomCode: newCode }));
                break;

            case 'register_monitor_node':
                if (ws.nodeRole === 'director' && ws.roomCode) {
                    const monitorToken = packet.monitorCode;
                    activeMonitorTokens[monitorToken] = { directorSocket: ws, masterRoomCode: ws.roomCode, monitorSocket: null };
                }
                break;

            case 'join_room':
                const targetCode = packet.roomCode;
                if (activeBroadcastRooms[targetCode]) {
                    const camSlotId = 'cam' + (Object.keys(activeBroadcastRooms[targetCode].connectedCameras).length + 1);
                    ws.nodeId = camSlotId;
                    ws.roomCode = targetCode;
                    ws.nodeRole = 'camera';
                    activeBroadcastRooms[targetCode].connectedCameras[camSlotId] = ws;
                    ws.send(JSON.stringify({ type: 'joined_successfully', cameraId: camSlotId }));
                    activeBroadcastRooms[targetCode].directorSocket.send(JSON.stringify({ type: 'camera_joined', cameraId: camSlotId }));
                }
                break;

            case 'join_monitor_room':
                const tokenInput = packet.roomCode;
                if (activeMonitorTokens[tokenInput]) {
                    const monitorUniqueId = 'monitor_' + Math.random().toString(36).substr(2, 9);
                    ws.nodeId = monitorUniqueId;
                    ws.nodeRole = 'monitor';
                    ws.assignedMonitorToken = tokenInput;
                    ws.send(JSON.stringify({ type: 'monitor_joined_successfully' }));
                    const currentDirector = activeMonitorTokens[tokenInput].directorSocket;
                    if (currentDirector && currentDirector.readyState === WebSocket.OPEN) {
                        activeMonitorTokens[tokenInput].monitorSocket = ws;
                        currentDirector.send(JSON.stringify({ type: 'monitor_requested', monitorId: monitorUniqueId }));
                    }
                }
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                if (ws.nodeRole === 'director') {
                    const currentToken = Object.keys(activeMonitorTokens).find(k => activeMonitorTokens[k].directorSocket === ws);
                    if (currentToken && activeMonitorTokens[currentToken].monitorSocket && activeMonitorTokens[currentToken].monitorSocket.nodeId === packet.targetId) {
                        packet.targetId = ws.nodeId; 
                        activeMonitorTokens[currentToken].monitorSocket.send(JSON.stringify(packet));
                    } else if (activeBroadcastRooms[ws.roomCode]) {
                        const targetCamNode = activeBroadcastRooms[ws.roomCode].connectedCameras[packet.targetId];
                        if (targetCamNode) {
                            packet.cameraId = ws.nodeId;
                            targetCamNode.send(JSON.stringify(packet));
                        }
                    }
                } else if (ws.nodeRole === 'camera' && activeBroadcastRooms[ws.roomCode]) {
                    packet.cameraId = ws.nodeId;
                    activeBroadcastRooms[ws.roomCode].directorSocket.send(JSON.stringify(packet));
                } else if (ws.nodeRole === 'monitor' && activeMonitorTokens[ws.assignedMonitorToken]) {
                    packet.targetId = ws.nodeId;
                    activeMonitorTokens[ws.assignedMonitorToken].directorSocket.send(JSON.stringify(packet));
                }
                break;
        }
    });

    ws.on('close', () => {
        if (ws.nodeRole === 'director' && ws.roomCode) {
            delete activeBroadcastRooms[ws.roomCode];
            Object.keys(activeMonitorTokens).forEach(token => {
                if (activeMonitorTokens[token].directorSocket === ws) delete activeMonitorTokens[token];
            });
        } else if (ws.nodeRole === 'camera' && activeBroadcastRooms[ws.roomCode]) {
            delete activeBroadcastRooms[ws.roomCode].connectedCameras[ws.nodeId];
        }
    });
});

server.listen(PORT, () => console.log(`CBP Cloud Signal Engine Deployment Success on Port ${PORT}`));
