const express = require('express');
const auth = require('../../middleware/auth.middleware');
const controller = require('./notification.controller');

const router = express.Router();

router.get('/:id/notifications', auth, controller.list);

module.exports = router;