const express = require('express');
const controller = require('./auth.controller');
const validate = require('../../middleware/validate.middleware');
const { signupSchema, loginSchema } = require('./auth.schema');

const router = express.Router();

router.post('/signup', validate(signupSchema), controller.signup);
router.post('/login', validate(loginSchema), controller.login);

module.exports = router;