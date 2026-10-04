const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../src/modules/auth/auth.service');

test('correct password verifies true', async () => {
  const hash = await hashPassword('s3cret-pass');
  assert.strictEqual(await verifyPassword('s3cret-pass', hash), true);
});

test('wrong password verifies false', async () => {
  const hash = await hashPassword('s3cret-pass');
  assert.strictEqual(await verifyPassword('wrong-pass', hash), false);
});

test('hash is not the plaintext password', async () => {
  const hash = await hashPassword('s3cret-pass');
  assert.notStrictEqual(hash, 's3cret-pass');
});