const express = require('express');
const auth = require('../../middleware/auth.middleware');
const controller = require('./account.controller');

const router = express.Router();

router.post('/', auth, controller.create);
router.get('/', auth, controller.list);
router.get('/:id', auth, controller.getOne);

module.exports = router;