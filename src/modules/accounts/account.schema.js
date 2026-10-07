const { z } = require('zod');

const createAccountSchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code, e.g. NGN')
    .transform((s) => s.toUpperCase()),
});

module.exports = { createAccountSchema };