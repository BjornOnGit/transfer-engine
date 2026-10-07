process.env.NOTIFICATION_QUEUE_NAME = 'notification-queue-deadletter-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Worker } = require('bullmq');
const pool = require('../src/config/database');
const { notificationQueue, NOTIFICATION_QUEUE, connection } = require('../src/lib/queue');
const { createFixture, cleanupFixture } = require('./helpers/ledger-fixture');
const { createProcessor } = require('../src/modules/notifications/dispatcher');
const { notifyTransferCompleted } = require('../src/modules/notifications/notification.service');

const PREFIX = 'notif-dead';
const MAX_ATTEMPTS = 3;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowOf = async (id) => (await pool.query(
  'SELECT status, attempt_count, last_error FROM notification_deliveries WHERE id = $1', [id])).rows[0];

test('always failing: exactly N attempts, then dead_letter, with no further retries', { timeout: 60000 }, async () => {
  const transferId = await fx.newTransfer('10');
  let calls = 0;
  const send = async () => {
    calls++;
    throw new Error('mock provider down');
  };

  worker = new Worker(NOTIFICATION_QUEUE, createProcessor({ send }), { connection });
  await worker.waitUntilReady();

  const delivery = await notifyTransferCompleted(transferId, 'webhook', {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 100 },
  });

  let row;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    row = await rowOf(delivery.id);
    if (row.status === 'dead_letter') break;
    await sleep(100);
  }

  assert.strictEqual(row.status, 'dead_letter');
  assert.strictEqual(row.attempt_count, MAX_ATTEMPTS);
  assert.strictEqual(row.last_error, 'mock provider down');
  assert.strictEqual(calls, MAX_ATTEMPTS);

  // give a stray extra retry plenty of time to show up, then confirm nothing happened
  await sleep(2500);
  assert.strictEqual(calls, MAX_ATTEMPTS);
  assert.strictEqual((await rowOf(delivery.id)).attempt_count, MAX_ATTEMPTS);

  const counts = await notificationQueue.getJobCounts('waiting', 'delayed', 'active', 'failed');
  assert.strictEqual(counts.failed, 1);
  assert.strictEqual(counts.waiting + counts.delayed + counts.active, 0);
});