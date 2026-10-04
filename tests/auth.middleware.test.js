const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../src/config/env');
const auth = require('../src/middleware/auth.middleware');

const run = (headers) =>
  new Promise((resolve) => {
    const req = { headers };
    auth(req, {}, (err) => resolve({ err, req }));
  });

test('no token -> 401', async () => {
  const { err } = await run({});
  assert.strictEqual(err.status, 401);
});

test('invalid token -> 401', async () => {
  const { err } = await run({ authorization: 'Bearer not-a-real-token' });
  assert.strictEqual(err.status, 401);
});

test('token signed with wrong secret -> 401', async () => {
  const bad = jwt.sign({ sub: 'u1' }, 'wrong-secret');
  const { err } = await run({ authorization: `Bearer ${bad}` });
  assert.strictEqual(err.status, 401);
});

test('valid token -> next() with req.user populated', async () => {
  const token = jwt.sign({ sub: 'user-123' }, jwtSecret);
  const { err, req } = await run({ authorization: `Bearer ${token}` });
  assert.strictEqual(err, undefined);
  assert.deepStrictEqual(req.user, { id: 'user-123' });
});