const { Queue } = require('bullmq');
const connection = require('../config/redis');

const NOTIFICATION_QUEUE = process.env.NOTIFICATION_QUEUE_NAME || 'notification-queue';

const notificationQueue = new Queue(NOTIFICATION_QUEUE, { connection });

module.exports = { NOTIFICATION_QUEUE, notificationQueue, connection };