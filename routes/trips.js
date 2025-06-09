import express from 'express';
import pool from '../db'; // assumes db.ts handles pg connection pool
const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const { tripId, numTeams, playersPerTeam, numRounds, scoringMethods, courses, teams } = req.body;

    const insertTrip = await pool.query(
      'INSERT INTO trips (trip_id, num_teams, players_per_team, num_rounds, scoring_methods, courses) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [tripId, numTeams, playersPerTeam, numRounds, scoringMethods, courses]
    );

    // Optional: insert teams and players in separate calls if you created those tables
    res.status(201).json(insertTrip.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
});

export default router;
