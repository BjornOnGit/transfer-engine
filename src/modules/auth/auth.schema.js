const { z } = require('zod');

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional(),
  password: z.string().min(8).max(72), // 72 = bcrypt's input limit
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

module.exports = { signupSchema, loginSchema };