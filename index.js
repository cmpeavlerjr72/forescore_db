import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import fetch from 'node-fetch';
import cors from 'cors';
import bodyParser from 'body-parser';
import { Server } from 'socket.io';
import http from 'http';
import bcrypt from 'bcrypt';


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
    'https://www.forescoreapp.com', // Your custom domain
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
app.post('/users/register', async (req, res) => {
    const { username, password, name, handicap } = req.body;
    if (!username || !password || !name || handicap === undefined) {
      return res.status(400).json({ error: 'Missing required user data' });
    }
  
    const usersData = readJsonFile(FILES.users, { users: [] });
    const existingUser = usersData.users.find((u) => u.username === username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }
  
    try {
      const hashedPassword = await bcrypt.hash(password, 10); // 10 salt rounds
      const newUser = {
         username, 
         password: hashedPassword, 
         name, 
         handicap, 
         trips: {},
         friends: [] };
      usersData.users.push(newUser);
      writeJsonFile(FILES.users, usersData);
      syncToGitHub(FILES.users, true);
      res.status(201).json({ message: 'User registered' });
    } catch (err) {
      console.error('Error registering user:', err);
      res.status(500).json({ error: 'Failed to register user' });
    }
  });

app.post('/users/login', async (req, res) => {
    const { username, password } = req.body;
    const usersData = readJsonFile(FILES.users, { users: [] });
    const user = usersData.users.find((u) => u.username === username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    try {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Incorrect password' });

        res.json({ message: 'Login successful', user });
    } catch (err) {
        console.error('Error verifying password:', err);
        res.status(500).json({ error: 'Login error' });
    }
    });

app.get('/users/:username', (req, res) => {
    const { username } = req.params;
    const usersData = readJsonFile(FILES.users, { users: [] });
    
    const user = usersData.users.find((u) => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Don't send the password hash back
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
    });

app.post('/users/:username/add-trip', (req, res) => {
    const { username } = req.params;
    const { tripId } = req.body;
    
    const usersData = readJsonFile(FILES.users, { users: [] });
    const tripsData = readJsonFile(FILES.trips, { trips: {} });
    
    const user = usersData.users.find((u) => u.username === username);
    const trip = tripsData.trips[tripId];
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (!trip) {
        return res.status(404).json({ error: 'Trip not found' });
    }
    
    // If trips were previously an array, convert it to an object
    if (!user.trips || Array.isArray(user.trips)) {
        user.trips = {};
    }
    
    if (!user.trips[tripId]) {
        // Initialize one empty array per round
        const numRounds = trip.numRounds || 1;
        user.trips[tripId] = {
        scores: Array.from({ length: numRounds }, () => [])
        };
    
        writeJsonFile(FILES.users, usersData);
        syncToGitHub(FILES.users, true);
    }
    
    res.json(user);
    });

app.post('/users/:username/save-score', (req, res) => {
    const { username } = req.params;
    const { tripId, roundIndex, scores } = req.body;
    
    if (!tripId || roundIndex === undefined || !Array.isArray(scores)) {
        return res.status(400).json({ error: 'Missing tripId, roundIndex, or scores' });
    }
    
    const data = readJsonFile(FILES.users, { users: [] });
    const user = data.users.find((u) => u.username === username);
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (!user.tripScores) user.tripScores = {};
    if (!user.tripScores[tripId]) user.tripScores[tripId] = [];
    
    // Update if roundIndex exists, else append
    const existing = user.tripScores[tripId].find((r) => r.roundIndex === roundIndex);
    if (existing) {
        existing.scores = scores;
    } else {
        user.tripScores[tripId].push({ roundIndex, scores });
    }
    
    writeJsonFile(FILES.users, data);
    syncToGitHub(FILES.users, true);
    res.json({ message: 'Scores saved', tripScores: user.tripScores[tripId] });
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
