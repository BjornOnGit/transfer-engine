const deliveryRepository = require('./delivery.repository');

// Stand-in for a real webhook / push / SMS call.
async function mockSend({ transferId, channel }) {
  console.log(`[notify] ${channel} delivered for transfer ${transferId}`);
}

function createProcessor({ send = mockSend } = {}) {
  return async (job) => {
    const { deliveryId } = job.data;
    try {
      await send(job.data);
    } catch (err) {
      const status = await deliveryRepository.markFailedAttempt(
      deliveryId, err.message, job.opts.attempts || 1);
      if (status === 'dead_letter') {
      console.error(`[notify] delivery ${deliveryId} dead-lettered, needs manual follow-up: ${err.message}`);
    }
    throw err; // BullMQ retries with backoff, or keeps the job as failed once attempts are exhausted
    }
    await deliveryRepository.markSent(deliveryId);
  };
}

module.exports = { createProcessor, mockSend };