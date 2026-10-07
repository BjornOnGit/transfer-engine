process.env.NOTIFICATION_QUEUE_NAME = 'notification-queue-retry-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Worker } = require('bullmq');
const pool = require('../src/config/database');
const { notificationQueue, NOTIFICATION_QUEUE, connection } = require('../src/lib/queue');
const { createFixture, cleanupFixture } = require('./helpers/ledger-fixture');
const { createProcessor } = require('../src/modules/notifications/dispatcher');
const { notifyTransferCompleted } = require('../src/modules/notifications/notification.service');

const PREFIX = 'notif-retry';
const BASE_DELAY = 2000;
let fx, worker;

before(async () => { fx = await createFixture(PREFIX); });

after(async () => {
  try {
    if (worker) await worker.close();
    await cleanupFixture(PREFIX);
  } finally {
    await notificationQueue.obliterate({ force: true });
    await notificationQueue.close();
    await pool.end();
    await connection.quit();
  }
});

test('fails twice then succeeds: 3 attempts, increasing delays, final status sent', { timeout: 40000 }, async () => {
  const transferId = await fx.newTransfer('10');
  const attemptTimes = [];
  const statusSeenAtAttempt = [];
  let deliveryId;
  let calls = 0;

  const send = async (data) => {
    calls++;
    attemptTimes.push(Date.now());
    const { rows } = await pool.query('SELECT status FROM notification_deliveries WHERE id = $1', [data.deliveryId]);
    statusSeenAtAttempt.push(rows[0].status);
    if (calls <= 2) throw new Error('mock provider down');
  };

  worker = new Worker(NOTIFICATION_QUEUE, createProcessor({ send }), { connection });
  await worker.waitUntilReady();

  const delivery = await notifyTransferCompleted(transferId, 'webhook', {
    backoff: { type: 'exponential', delay: BASE_DELAY },
  });
  deliveryId = delivery.id;

  let row;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    ({ rows: [row] } = await pool.query(
      'SELECT status, attempt_count, last_error FROM notification_deliveries WHERE id = $1', [deliveryId]));
    if (row.status === 'sent') break;
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.strictEqual(row.status, 'sent');
  assert.strictEqual(row.attempt_count, 3);
  assert.strictEqual(row.last_error, null);
  assert.strictEqual(attemptTimes.length, 3);
  assert.deepStrictEqual(statusSeenAtAttempt, ['pending', 'retrying', 'retrying']);

  const gap1 = attemptTimes[1] - attemptTimes[0];
  const gap2 = attemptTimes[2] - attemptTimes[1];
  assert.ok(gap1 >= BASE_DELAY * 0.9, `first gap ${gap1}ms`);
  assert.ok(gap2 >= BASE_DELAY * 2 * 0.9, `second gap ${gap2}ms`);
  assert.ok(gap2 > gap1, `delays should grow: ${gap1}ms then ${gap2}ms`);
});