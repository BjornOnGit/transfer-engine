const express = require('express');
const auth = require('../../middleware/auth.middleware');
const controller = require('./account.controller');
const validate = require('../../middleware/validate.middleware');
const { createAccountSchema } = require('./account.schema');

const router = express.Router();

router.post('/', auth, validate(createAccountSchema), controller.create);
router.get('/', auth, controller.list);
router.get('/:id', auth, controller.getOne);

module.exports = router;