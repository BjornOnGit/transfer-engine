const express = require('express');
const auth = require('../../middleware/auth.middleware');
const idempotency = require('../../middleware/idempotency.middleware');
const controller = require('./transfer.controller');

const router = express.Router();

router.post('/', auth, idempotency, controller.create);

router.get('/:id', auth, controller.getOne);

module.exports = router;