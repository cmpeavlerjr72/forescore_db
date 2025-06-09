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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
