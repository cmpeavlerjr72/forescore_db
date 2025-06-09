// index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const tripsRouter = require('./routes/trips');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
