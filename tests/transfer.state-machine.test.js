const test = require('node:test');
const assert = require('node:assert');
const { TRANSITIONS, canTransition } = require('../src/modules/transfers/transfer.state-machine');

test('valid transitions along the happy path return true', () => {
  assert.strictEqual(canTransition('initiated', 'rate_locked'), true);
  assert.strictEqual(canTransition('rate_locked', 'funds_moved'), true);
  assert.strictEqual(canTransition('funds_moved', 'completed'), true);
});

test('skipping a state returns false', () => {
  assert.strictEqual(canTransition('initiated', 'funds_moved'), false);
  assert.strictEqual(canTransition('initiated', 'completed'), false);
  assert.strictEqual(canTransition('rate_locked', 'completed'), false);
});

test('going backwards returns false', () => {
  assert.strictEqual(canTransition('completed', 'funds_moved'), false);
  assert.strictEqual(canTransition('rate_locked', 'initiated'), false);
});

test('failed is only reachable before funds move; reversed only after', () => {
  assert.strictEqual(canTransition('initiated', 'failed'), true);
  assert.strictEqual(canTransition('rate_locked', 'failed'), true);
  assert.strictEqual(canTransition('funds_moved', 'failed'), false);
  assert.strictEqual(canTransition('funds_moved', 'reversed'), true);
  assert.strictEqual(canTransition('completed', 'reversed'), true);
  assert.strictEqual(canTransition('initiated', 'reversed'), false);
});

test('failed and reversed are terminal', () => {
  assert.deepStrictEqual(TRANSITIONS.failed, []);
  assert.deepStrictEqual(TRANSITIONS.reversed, []);
});

test('unknown states return false', () => {
  assert.strictEqual(canTransition('nonsense', 'completed'), false);
  assert.strictEqual(canTransition('initiated', 'nonsense'), false);
});