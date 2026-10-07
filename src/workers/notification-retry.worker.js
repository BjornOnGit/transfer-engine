const { Worker } = require('bullmq');
const { NOTIFICATION_QUEUE, connection } = require('../lib/queue');
const { createProcessor } = require('../modules/notifications/dispatcher');

function start() {
  const worker = new Worker(NOTIFICATION_QUEUE, createProcessor(), { connection });
  worker.on('failed', (job, err) =>
    console.error(`[notification-worker] job ${job && job.id} attempt ${job && job.attemptsMade} failed: ${err.message}`));
  console.log('[notification-worker] started');
  return worker;
}

module.exports = { start };

if (require.main === module) start();