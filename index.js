import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import fetch from 'node-fetch';
import cors from 'cors';
import bodyParser from 'body-parser';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 5001;
const allowedOrigins = [
    'http://localhost:5173',     // Vite dev
    'http://127.0.0.1:5173',     // Alt Vite dev
    'https://forescoreapp.com',  // Your custom domain
    'https://forescore.onrender.com' // Render Url
  ];

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));
app.use(bodyParser.json());

const DATA_PATH = './data';
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH);

const FILES = {
  trips: `${DATA_PATH}/trips.json`,
  users: `${DATA_PATH}/users.json`,
};

// GitHub config
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

// For rate limiting syncs
let lastSyncTime = null;
const SYNC_INTERVAL = 60000;
const syncQueue = [];

// Helpers
const readJsonFile = (filePath, defaultValue = {}) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return defaultValue;
  }
};

const writeJsonFile = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`${filePath} updated`);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
  }
};

const syncToGitHub = async (filePath, force = false) => {
  const now = new Date();
  if (!force && lastSyncTime && (now - lastSyncTime) < SYNC_INTERVAL) {
    syncQueue.push(filePath);
    return;
  }

  const filename = filePath.split('/').pop();
  const githubPath = `data/${filename}`;
  const GITHUB_URL = `${GITHUB_API_BASE}/${githubPath}`;
  const data = readJsonFile(filePath);

  try {
    const current = await fetch(GITHUB_URL, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    }).then((res) => res.json());

    await fetch(GITHUB_URL, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Sync ${filename}`,
        content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
        sha: current.sha,
      }),
    });

    lastSyncTime = now;
    console.log(`✅ Synced ${filename} to GitHub`);
  } catch (err) {
    console.error(`❌ Sync failed for ${filename}:`, err.message);
    syncQueue.push(filePath);
  }
};

const restoreFromGitHub = async (filePath) => {
  const filename = filePath.split('/').pop();
  const githubPath = `data/${filename}`;
  const GITHUB_URL = `${GITHUB_API_BASE}/${githubPath}`;

  try {
    const res = await fetch(GITHUB_URL, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    const data = await res.json();
    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    writeJsonFile(filePath, JSON.parse(decoded));
    console.log(`✅ Restored ${filename} from GitHub`);
  } catch (err) {
    console.error(`❌ Restore failed for ${filename}:`, err.message);
  }
};

// ========== TRIP ROUTES ==========
app.get('/trips/:tripId', (req, res) => {
  const data = readJsonFile(FILES.trips, { trips: {} });
  const trip = data.trips[req.params.tripId];
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(trip);
});

app.post('/trips', (req, res) => {
  try {
    const data = readJsonFile(FILES.trips, { trips: {} });
    const trip = req.body;
    data.trips[trip.tripId] = trip;
    writeJsonFile(FILES.trips, data);
    syncToGitHub(FILES.trips, true);
    res.status(201).json({ message: 'Trip saved', trip });
  } catch (err) {
    console.error('Failed to save trip:', err.message);
    res.status(500).json({ error: 'Failed to save trip' });
  }
});

// ========== USER ROUTES ==========
app.post('/users/register', (req, res) => {
    const { username, password, name, handicap } = req.body;
    const users = readJsonFile(FILES.users, { users: {} });
  
    if (!username || !password || !name || handicap === undefined) {
      return res.status(400).json({ error: 'Missing required user data' });
    }
  
    if (users[username]) {
      return res.status(409).json({ error: 'Username already exists' });
    }
  
    users[username] = {
      password,
      name,
      handicap,
      trips: [],
      friends: []
    };
  
    writeJsonFile(FILES.users, users);
    syncToGitHub(FILES.users, true);
    res.status(201).json({ message: 'User registered successfully' });
  });

app.post('/users/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJsonFile(FILES.users, { users: {} });

  if (!users[username] || users[username].password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ message: 'Login successful', trips: users[username].trips });
});

app.post('/users/:username/add-trip', (req, res) => {
  const { username } = req.params;
  const { tripId } = req.body;
  const users = readJsonFile(FILES.users, { users: {} });

  if (!users[username]) return res.status(404).json({ error: 'User not found' });
  if (!users[username].trips.includes(tripId)) {
    users[username].trips.push(tripId);
    writeJsonFile(FILES.users, users);
    syncToGitHub(FILES.users, true);
  }

  res.json({ message: 'Trip added to user', trips: users[username].trips });
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log(`🟢 User connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
  });
});

// Startup
restoreFromGitHub(FILES.trips);
restoreFromGitHub(FILES.users);
setInterval(() => {
  if (syncQueue.length > 0) syncToGitHub(syncQueue.shift());
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
