const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const DATA_FILE = path.join(__dirname, 'users.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// Helper to read/write users
function readData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE));
}
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Helper to read/write sessions
function readSessions() {
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}
function writeSessions(data) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

// Generate a secure token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// --- REST Endpoints ---

app.post('/api/signup', (req, res) => {
    const { userId, name, password } = req.body;
    const users = readData();
    if (!userId || !password) return res.status(400).json({ success: false, message: 'Required fields missing.' });
    if (users[userId]) return res.status(409).json({ success: false, message: 'Exists already.' });
    users[userId] = { name: name || 'Explorer', password, points: 0, createdAt: new Date().toISOString() };
    writeData(users);

    // Auto-create session token on signup
    const token = generateToken();
    const sessions = readSessions();
    sessions[token] = { userId, createdAt: new Date().toISOString() };
    writeSessions(sessions);

    res.json({ success: true, uniqueId: userId, points: 0, name: users[userId].name, token });
});

app.post('/api/signin', (req, res) => {
    const { userId, password } = req.body;
    const users = readData();
    if (users[userId] && users[userId].password === password) {
        // Create session token
        const token = generateToken();
        const sessions = readSessions();
        sessions[token] = { userId, createdAt: new Date().toISOString() };
        writeSessions(sessions);

        res.json({ success: true, uniqueId: userId, points: users[userId].points, name: users[userId].name, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
});

// NEW: Verify session token (for cross-device login)
app.get('/api/session/:token', (req, res) => {
    const { token } = req.params;
    const sessions = readSessions();
    const session = sessions[token];
    if (!session) return res.status(404).json({ success: false, message: 'Session expired or invalid.' });

    const users = readData();
    const user = users[session.userId];
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({ success: true, uniqueId: session.userId, points: user.points, name: user.name });
});

app.get('/api/points/:userId', (req, res) => {
    const users = readData();
    if (users[req.params.userId]) {
        res.json({ success: true, points: users[req.params.userId].points, name: users[req.params.userId].name });
    } else {
        res.status(404).json({ success: false });
    }
});

app.post('/api/points', (req, res) => {
    const { userId, pointsToAdd } = req.body;
    const users = readData();
    if (users[userId]) {
        users[userId].points += (pointsToAdd || 0);
        writeData(users);
        res.json({ success: true, totalPoints: users[userId].points });
    } else res.status(404).json({ success: false });
});

app.post('/api/points/redeem', (req, res) => {
    const { userId, points } = req.body;
    const users = readData();
    if (users[userId]) {
        if (users[userId].points >= points) {
            users[userId].points -= points;
            writeData(users);
            res.json({ success: true, message: 'Points successfully secured!', totalPoints: users[userId].points });
        } else {
            res.status(400).json({ success: false, error: 'Insufficient credits in vault.' });
        }
    } else {
        res.status(404).json({ success: false, error: 'User not found in Qrio network.' });
    }
});

// --- Socket.io Multiplayer Logic ---
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name: playerName, score: 0 }],
            gameState: 'waiting'
        };
        socket.emit('roomUpdated', rooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            rooms[roomId].players.push({ id: socket.id, name: playerName, score: 0 });
            io.to(roomId).emit('roomUpdated', rooms[roomId]);
        } else {
            socket.emit('error', 'Room not found!');
        }
    });

    socket.on('startGame', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].gameState = 'playing';
            io.to(roomId).emit('gameStarted', rooms[roomId]);
        }
    });

    socket.on('submitAnswer', ({ roomId, playerName, isCorrect }) => {
        if (rooms[roomId]) {
            const player = rooms[roomId].players.find(p => p.id === socket.id);
            if (player && isCorrect) player.score += 10;
            io.to(roomId).emit('roomUpdated', rooms[roomId]);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`Qrio Multiplayer Engine running on port ${PORT}`);
});
