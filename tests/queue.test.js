const { test, after } = require('node:test');
const assert = require('node:assert');
const { Queue, Worker } = require('bullmq');
const { notificationQueue, connection } = require('../src/lib/queue');

const smokeQueue = new Queue('queue-smoke-test', { connection });

after(async () => {
  await smokeQueue.close();
  await notificationQueue.close();
  await connection.quit();
});

test('an enqueued job is picked up and logged within a second', { timeout: 10000 }, async () => {
  let resolvePicked;
  const picked = new Promise((resolve) => { resolvePicked = resolve; });

  const worker = new Worker(
    'queue-smoke-test',
    async (job) => {
      console.log(`[queue-test] picked up job ${job.id} (${job.name}):`, job.data);
      resolvePicked({ data: job.data, at: Date.now() });
    },
    { connection }
  );

  try {
    await worker.waitUntilReady();
    const enqueuedAt = Date.now();
    await smokeQueue.add('test-job', { hello: 'world' }, { removeOnComplete: true, removeOnFail: true });

    const { data, at } = await picked;
    assert.deepStrictEqual(data, { hello: 'world' });
    assert.ok(at - enqueuedAt < 1000, `pickup took ${at - enqueuedAt}ms`);
  } finally {
    await worker.close();
  }
});