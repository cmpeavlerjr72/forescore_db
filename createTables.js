const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const createTables = async () => {
  await client.connect();
  await client.query(`
    CREATE TABLE trips (
      id SERIAL PRIMARY KEY,
      trip_id TEXT UNIQUE NOT NULL,
      num_teams INTEGER NOT NULL,
      players_per_team INTEGER NOT NULL,
      num_rounds INTEGER NOT NULL
    );

    CREATE TABLE teams (
      id SERIAL PRIMARY KEY,
      trip_id TEXT REFERENCES trips(trip_id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );

    CREATE TABLE players (
      id SERIAL PRIMARY KEY,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      scores JSONB NOT NULL,
      lineup_order JSONB NOT NULL
    );

    CREATE TABLE rounds (
      id SERIAL PRIMARY KEY,
      trip_id TEXT REFERENCES trips(trip_id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      scoring_method TEXT CHECK (scoring_method IN ('match', 'stroke')) NOT NULL,
      course TEXT NOT NULL
    );
  `);
  console.log('✅ Tables created!');
  await client.end();
};

createTables().catch(console.error);
