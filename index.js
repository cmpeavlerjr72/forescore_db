import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// Set up PostgreSQL connection
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Needed for Render external PostgreSQL connections
  },
});

app.use('/api', tripsRouter);

app.get('/', (req, res) => res.send('ForeScore Backend is running.'));

app.post('/api/trips/create', async (req, res) => {
    const tripData = req.body;
  
    console.log('--- Incoming Trip Data ---');
    console.log(JSON.stringify(tripData, null, 2)); // Pretty-print JSON
  
    try {
      // Your existing DB INSERT logic
      res.status(200).json({ message: 'Trip saved successfully' });
    } catch (error) {
      console.error('Error saving trip:', error);
      res.status(500).json({ message: 'Failed to save trip' });
    }
});

app.get('/api/trips/:tripId', async (req, res) => {
    const tripId = req.params.tripId;
  
    try {
      const result = await pool.query('SELECT * FROM trips WHERE trip_id = $1', [tripId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }
  
      const trip = result.rows[0];
      const parsedTrip = {
        tripId: trip.trip_id,
        numTeams: trip.num_teams,
        playersPerTeam: trip.players_per_team,
        numRounds: trip.num_rounds,
        scoringMethods: JSON.parse(trip.scoring_methods),
        courses: JSON.parse(trip.courses),
        teams: JSON.parse(trip.teams),
      };
  
      res.json(parsedTrip);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch trip' });
    }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
