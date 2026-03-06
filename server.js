const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
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

// Helper to read data
function readData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

// Helper to write data
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// REST endpoints... (Signup, Signin, Points stay same)
app.post('/api/signup', (req, res) => {
    const { userId, name, password } = req.body;
    const users = readData();
    if (!userId || !password) return res.status(400).json({ success: false, message: 'Required fields missing.' });
    if (users[userId]) return res.status(409).json({ success: false, message: 'Exists already.' });
    users[userId] = { name: name || 'Explorer', password, points: 0, createdAt: new Date().toISOString() };
    writeData(users);
    res.json({ success: true, uniqueId: userId, points: 0, name: users[userId].name });
});

app.post('/api/signin', (req, res) => {
    const { userId, password } = req.body;
    const users = readData();
    if (users[userId] && users[userId].password === password) {
        res.json({ success: true, uniqueId: userId, points: users[userId].points, name: users[userId].name });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
});

app.get('/api/points/:userId', (req, res) => {
    const users = readData();
    if (users[req.params.userId]) res.json({ success: true, points: users[req.params.userId].points });
    else res.status(404).json({ success: false });
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
        // Cleanup logic could be added here
        console.log('User disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`Qrio Multiplayer Engine running on port ${PORT}`);
});
