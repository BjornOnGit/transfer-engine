const { z } = require('zod');

const createTransferSchema = z.object({
  senderAccountId: z.string().uuid(),
  receiverAccountId: z.string().uuid(),
  amount: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => /^(?=.*[1-9])\d+(\.\d{1,2})?$/.test(v), {
      message: 'amount must be a positive number with at most 2 decimals',
    }),
});

module.exports = { createTransferSchema };