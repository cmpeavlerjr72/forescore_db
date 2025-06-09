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

app.use(cors());
app.use(bodyParser.json());

const DATA_PATH = './data';
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH);
}

const FILES = {
  trips: `${DATA_PATH}/trips.json`,
};

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'data/trips.json';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

let lastUpdateTime = null;
let lastSyncTime = null;
const SYNC_INTERVAL = 60000; // 60 seconds rate limit
const syncQueue = []; // Queue for failed sync attempts

const getEasternTime = () => {
  const now = new Date();
  const estOffset = -5;
  return new Date(now.getTime() + estOffset * 60 * 60 * 1000).toISOString();
};

const readJsonFile = (filePath, defaultValue = { trips: {} }) => {
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
    console.log(`${filePath} updated successfully`);
  } catch (err) {
    console.error(`Error writing to ${filePath}:`, err.message);
    throw err;
  }
};

const syncToGitHub = async (filePath, force = false) => {
  const now = new Date();
  if (!force && lastSyncTime && (now - lastSyncTime) < SYNC_INTERVAL) {
    console.log('Queuing GitHub sync due to rate limiting');
    syncQueue.push(filePath);
    return;
  }

  const data = readJsonFile(filePath);
  try {
    const current = await fetch(GITHUB_API_URL, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    }).then((res) => res.json());

    const res = await fetch(GITHUB_API_URL, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Sync ${filePath.split('/').pop()} from Render`,
        content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
        sha: current.sha,
      }),
    });

    if (!res.ok) throw new Error(`GitHub sync failed: ${res.status}`);
    console.log(`✅ Synced ${filePath.split('/').pop()} to GitHub`);
    lastSyncTime = now;
    // Process queued syncs if any
    if (syncQueue.length > 0) {
      const nextFile = syncQueue.shift();
      await syncToGitHub(nextFile);
    }
  } catch (err) {
    console.error(`❌ GitHub sync error for ${filePath}:`, err.message);
    syncQueue.push(filePath); // Re-queue on failure
  }
};

const restoreFromGitHub = async (filePath) => {
  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });

    if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
    const data = await res.json();
    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    writeJsonFile(filePath, JSON.parse(decoded));
    console.log(`✅ Restored ${filePath.split('/').pop()} from GitHub`);
  } catch (err) {
    console.error(`❌ Failed to restore ${filePath}:`, err.message);
    // Use local file as fallback if GitHub restore fails
    writeJsonFile(filePath, readJsonFile(filePath));
  }
};

// API routes for trips
app.get('/trips', (req, res) => {
  const data = readJsonFile(FILES.trips);
  res.json(data.trips);
});

app.get('/trips/:tripId', (req, res) => {
  const data = readJsonFile(FILES.trips);
  const trip = data.trips[req.params.tripId];
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(trip);
});

app.post('/trips', (req, res) => {
  try {
    const { tripId, numTeams, playersPerTeam, numRounds, courses, scoringMethods, teams } = req.body;
    if (!tripId || !numTeams || !playersPerTeam || !numRounds || !courses || !scoringMethods || !teams) {
      return res.status(400).json({ error: 'Missing required trip data' });
    }

    const data = readJsonFile(FILES.trips);
    data.trips[tripId] = { tripId, numTeams, playersPerTeam, numRounds, courses, scoringMethods, teams };
    writeJsonFile(FILES.trips, data);
    syncToGitHub(FILES.trips, true); // Force immediate sync for new trips
    res.status(201).json({ message: 'Trip created', trip: data.trips[tripId] });

    io.emit('trip-update', { action: 'create', tripId, trip: data.trips[tripId] });
  } catch (err) {
    console.error('Error creating trip:', err.message);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

app.put('/trips/:tripId', (req, res) => {
  try {
    const data = readJsonFile(FILES.trips);
    const tripId = req.params.tripId;
    if (!data.trips[tripId]) return res.status(404).json({ error: 'Trip not found' });
    data.trips[tripId] = { ...data.trips[tripId], ...req.body };
    writeJsonFile(FILES.trips, data);
    syncToGitHub(FILES.trips, true); // Force immediate sync for updates
    res.json({ message: 'Trip updated', trip: data.trips[tripId] });

    io.emit('trip-update', { action: 'update', tripId, trip: data.trips[tripId] });
  } catch (err) {
    console.error('Error updating trip:', err.message);
    res.status(500).json({ error: 'Failed to update trip' });
  }
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('🟢 New user connected:', socket.id);

  socket.on('subscribe-trip', (tripId) => {
    console.log(`User ${socket.id} subscribed to trip ${tripId}`);
    socket.join(`trip-${tripId}`);
  });

  socket.on('update-score', ({ tripId, playerId, roundIndex, score }) => {
    try {
      const data = readJsonFile(FILES.trips);
      const trip = data.trips[tripId];
      if (!trip) {
        socket.emit('score-update', { success: false, error: 'Trip not found' });
        return;
      }

      const team = trip.teams.find(t => t.players.some(p => p.id === playerId));
      if (team) {
        const player = team.players.find(p => p.id === playerId);
        if (player && player.scores && player.scores[roundIndex] !== undefined) {
          player.scores[roundIndex] = score;
          writeJsonFile(FILES.trips, data);
          syncToGitHub(FILES.trips, true); // Force immediate sync for score updates
          io.to(`trip-${tripId}`).emit('score-update', { success: true, tripId, playerId, roundIndex, score });
        } else {
          socket.emit('score-update', { success: false, error: 'Player or round not found' });
        }
      } else {
        socket.emit('score-update', { success: false, error: 'Team not found' });
      }
    } catch (err) {
      console.error('Error updating score:', err.message);
      socket.emit('score-update', { success: false, error: 'Failed to update score' });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 User disconnected:', socket.id);
  });
});

// Restore trips on startup and schedule periodic sync
restoreFromGitHub(FILES.trips);
setInterval(() => {
  if (syncQueue.length > 0) {
    syncToGitHub(syncQueue.shift());
  }
}, 5000); // Check queue every 5 seconds

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ForeScore Server running on http://0.0.0.0:${PORT}`);
});