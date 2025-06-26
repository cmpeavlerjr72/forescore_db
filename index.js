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

app.post('/trips', async (req, res) => {
  try {
    const data = readJsonFile(FILES.trips, { trips: {} });
    const trip = req.body;

    if (!trip.tripId || !trip.tripLeader) {
      return res.status(400).json({ error: 'tripId and tripLeader are required' });
    }

    console.log('Saving trip:', trip.tripId); // Debug log
    data.trips[trip.tripId] = trip;
    writeJsonFile(FILES.trips, data);

    // User update logic
    const usersData = readJsonFile(FILES.users, { users: [] });
    const tripLeader = trip.tripLeader;
    const user = usersData.users.find((u) => u.username === tripLeader);

    if (user) {
      if (!user.trips || typeof user.trips !== 'object') user.trips = {};
      if (!user.trips[trip.tripId]) {
        user.trips[trip.tripId] = {
          raw_scores: Array.from({ length: trip.numRounds || 1 }, () => []),
          net_scores: Array.from({ length: trip.numRounds || 1 }, () => [])
        };
      }

      // Update trip.users in the same data object to avoid overwriting
      if (!data.trips[trip.tripId].users) data.trips[trip.tripId].users = [];
      if (!data.trips[trip.tripId].users.includes(tripLeader)) {
        data.trips[trip.tripId].users.push(tripLeader);
      }

      usersData.users = usersData.users.map(u => u.username === tripLeader ? user : u);
      writeJsonFile(FILES.users, usersData);
    }

    await syncToGitHub(FILES.trips, true).catch(err => console.error('Sync failed:', err));
    await syncToGitHub(FILES.users, true).catch(err => console.error('Sync failed:', err));

    res.status(201).json({ message: 'Trip saved and user updated', trip });
  } catch (err) {
    console.error('Failed to save trip:', err.message);
    res.status(500).json({ error: 'Failed to save trip', details: err.message });
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

  app.post('/users/:username/add-trip', async (req, res) => {
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
    
    if (!user.trips || Array.isArray(user.trips)) {
        user.trips = {};
    }
    
    if (!user.trips[tripId]) {
        const numRounds = trip.numRounds || 1;
        user.trips[tripId] = {
            raw_scores: Array.from({ length: numRounds }, () => []),
            net_scores: Array.from({ length: numRounds }, () => []),
        };
    }
    
    if (!Array.isArray(trip.users)) {
        trip.users = [];
    }
    
    if (!trip.users.includes(username)) {
        trip.users.push(username);
        tripsData.trips[tripId] = trip;
        writeJsonFile(FILES.trips, tripsData);
        await syncToGitHub(FILES.trips, true); // Await sync completion
    }
    
    writeJsonFile(FILES.users, usersData);
    await syncToGitHub(FILES.users, true); // Await sync completion
    
    res.json(user);
  });
      

// ========== SUBMIT SCORES (RAW + NET) ==========
// Accepts frontend-calculated raw and net scores and saves them under user.trips[tripId]
 
app.post('/users/:username/trips/:tripId/save-scores', (req, res) => {
  const { username, tripId } = req.params;
  const { round, raw, net } = req.body;

  if (
    typeof round !== 'number' ||
    !Array.isArray(raw) || raw.length !== 18 ||
    !Array.isArray(net) || net.length !== 18
  ) {
    return res.status(400).json({ error: 'Round must be a number and raw/net must be arrays of length 18' });
  }

  const data = readJsonFile(FILES.users, { users: [] });
  const user = data.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.trips || typeof user.trips !== 'object') user.trips = {};
  if (!user.trips[tripId]) {
    user.trips[tripId] = {
      raw_scores: [],
      net_scores: [],
    };
  }

  // ✅ Write to correct round index
  user.trips[tripId].raw_scores[round] = raw;
  user.trips[tripId].net_scores[round] = net;

  writeJsonFile(FILES.users, data);
  syncToGitHub(FILES.users, true);
  res.json({ message: 'Scores submitted' });
});

  app.get('/users/:username/trips/:tripId/scores', (req, res) => {
    const { username, tripId } = req.params;
    const round = req.query.round; // Type: string | qs.ParsedQs | string[] | qs.ParsedQs[] | undefined
    const data = readJsonFile(FILES.users, { users: [] });
    const user = data.users.find((u) => u.username === username);
  
    if (!user) return res.status(404).json({ error: 'User not found' });
    const tripData = user.trips?.[tripId];
  
    if (!tripData || !tripData.raw_scores?.length) {
      return res.json({ raw: null, net: null });
    }
  
    if (round) {
      // Safely handle the round query parameter
      const roundValue = Array.isArray(round) ? round[0] : round.toString();
      const roundIndex = parseInt(roundValue, 10);
      if (!isNaN(roundIndex) && roundIndex >= 0 && roundIndex < tripData.raw_scores.length) {
        return res.json({
          raw: tripData.raw_scores[roundIndex],
          net: tripData.net_scores[roundIndex],
        });
      }
      return res.status(400).json({ error: 'Invalid round index' });
    }
  
    // Return all rounds if no round is specified
    res.json({
      raw: tripData.raw_scores,
      net: tripData.net_scores,
    });
  });

  app.post('/users/:username/trips/:tripId/save-projected-points', (req, res) => {
    const { username, tripId } = req.params;
    const { projectedPoints } = req.body;
  
    const data = readJsonFile(FILES.users, { users: [] });
    const user = data.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'User not found' });
  
    if (!user.trips) user.trips = {};
    if (!user.trips[tripId]) user.trips[tripId] = {};
  
    user.trips[tripId].projected_points = projectedPoints;
    writeJsonFile(FILES.users, data);
    syncToGitHub(FILES.users, true);
  
    res.json({ message: 'Projected points saved' });
  });

  // ========== SAVE LINEUPS ==========
// Save new team assignments and match play pairings
app.post('/trips/:tripId/set-lineup', async (req, res) => {
  const { tripId } = req.params;
  const { teams, lineups } = req.body;

  try {
    const data = readJsonFile(FILES.trips, { trips: {} });

    if (!data.trips[tripId]) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    // Save the updated teams and match play lineups
    data.trips[tripId].teams = teams;
    data.trips[tripId].lineups = lineups;

    writeJsonFile(FILES.trips, data);
    await syncToGitHub(FILES.trips, true);

    res.status(200).json({ message: 'Lineup successfully saved' });
  } catch (err) {
    console.error('❌ Failed to save lineups:', err.message);
    res.status(500).json({ error: 'Failed to save lineups' });
  }
});
  
  
  // ========== SOCKET.IO ==========
  io.on('connection', (socket) => {
    console.log(`🟢 User connected: ${socket.id}`);
  
    socket.on('disconnect', () => {
      console.log(`🔴 User disconnected: ${socket.id}`);
    });
  });
  
  // Startup logic
  restoreFromGitHub(FILES.trips);
  restoreFromGitHub(FILES.users);
  setInterval(() => {
    if (syncQueue.length > 0) syncToGitHub(syncQueue.shift());
  }, 5000);
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  });
