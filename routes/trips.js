// routes/trips.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/trips', async (req, res) => {
  const { tripId, numTeams, playersPerTeam, numRounds, courses, scoringMethods } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO trips (trip_id, num_teams, players_per_team, num_rounds, courses, scoring_methods)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tripId, numTeams, playersPerTeam, numRounds, JSON.stringify(courses), JSON.stringify(scoringMethods)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database insert failed' });
  }
});

module.exports = router;
