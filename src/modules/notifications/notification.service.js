const deliveryRepository = require('./delivery.repository');
const { notificationQueue } = require('../../lib/queue');

const JOB_OPTIONS = {
  removeOnComplete: true,
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
};

async function notifyTransferCompleted(transferId, channel = 'webhook', jobOptions = {}) {
  const delivery = await deliveryRepository.createDelivery(transferId, channel);
  await notificationQueue.add(
    'transfer-completed',
    { deliveryId: delivery.id, transferId, channel },
    { ...JOB_OPTIONS, ...jobOptions }
  );
  return delivery;
}

module.exports = { notifyTransferCompleted, JOB_OPTIONS };