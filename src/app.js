const express = require('express');
const errorHandler = require('./middleware/error-handler');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(errorHandler);

module.exports = app;