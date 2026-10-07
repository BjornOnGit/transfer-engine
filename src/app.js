const express = require('express');
const errorHandler = require('./middleware/error-handler');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/auth', require('./modules/auth/auth.routes'));
app.use('/accounts', require('./modules/accounts/account.routes'));
app.use('/transfers', require('./modules/transfers/transfer.routes'));
app.use('/transfers', require('./modules/notifications/notification.routes'));

app.use(errorHandler);

module.exports = app;