const test = require('node:test');
const assert = require('node:assert');
const { add, subtract, compare, format } = require('../src/lib/money');

test('add("0.1", "0.2") is exactly "0.3"', () => {
  assert.strictEqual(add('0.1', '0.2'), '0.3');
});

test('subtract is exact', () => {
  assert.strictEqual(subtract('0.3', '0.1'), '0.2');
});

test('compare returns -1, 0, 1', () => {
  assert.strictEqual(compare('1.00', '2.00'), -1);
  assert.strictEqual(compare('2.0', '2.00'), 0);
  assert.strictEqual(compare('3', '2.99'), 1);
});

test('format fixes decimal places', () => {
  assert.strictEqual(format('1.5'), '1.50');
  assert.strictEqual(format('1.5', 0), '2');
});