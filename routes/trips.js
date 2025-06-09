// routes/trips.js
import express from 'express';
import { pool } from '../index.js'; // Adjust if db connection is in a separate file

const router = express.Router();

// POST /api/trips - Create a new trip
router.post('/trips', async (req, res) => {
  const { tripId, numTeams, playersPerTeam, numRounds, courses, scoringMethods, teams } = req.body;

  try {
    // Validate required fields
    if (!tripId || !numTeams || !playersPerTeam || !numRounds || !courses || !scoringMethods || !teams) {
      return res.status(400).json({ error: 'Missing required trip data' });
    }

    // Insert trip into database
    const query = `
      INSERT INTO trips (trip_id, num_teams, players_per_team, num_rounds, courses, scoring_methods, teams)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      tripId,
      numTeams,
      playersPerTeam,
      numRounds,
      JSON.stringify(courses),  // Store as JSON string
      JSON.stringify(scoringMethods), // Store as JSON string
      JSON.stringify(teams),    // Store as JSON string
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ message: 'Trip created successfully', trip: result.rows[0] });
  } catch (err) {
    console.error('Error creating trip:', err.message);
    res.status(500).json({ error: 'Failed to create trip', details: err.message });
  }
});

// Optional: GET /api/trips/:tripId - Fetch a trip (if not handled in index.js)
router.get('/trips/:tripId', async (req, res) => {
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
      courses: JSON.parse(trip.courses),
      scoringMethods: JSON.parse(trip.scoring_methods),
      teams: JSON.parse(trip.teams),
    };

    res.json(parsedTrip);
  } catch (err) {
    console.error('Error fetching trip:', err.message);
    res.status(500).json({ error: 'Failed to fetch trip', details: err.message });
  }
});

export default router;