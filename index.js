import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import tripsRouter from './routes/trips.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
    process.exit(1);
  }
  console.log('Connected to Render PostgreSQL database!');
});

app.use('/api', tripsRouter);

app.get('/', (req, res) => res.send('ForeScore Backend is running.'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});