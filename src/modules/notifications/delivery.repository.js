const pool = require('../../config/database');

async function createDelivery(transferId, channel) {
  const { rows } = await pool.query(
    `INSERT INTO notification_deliveries (transfer_id, channel)
     VALUES ($1, $2)
     RETURNING id, transfer_id, channel, status, attempt_count`,
    [transferId, channel]
  );
  return rows[0];
}

async function markSent(id) {
  await pool.query(
    `UPDATE notification_deliveries
     SET status = 'sent', attempt_count = attempt_count + 1, last_attempt_at = now(), last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

// Records a failed attempt. Becomes 'dead_letter' once maxAttempts is reached, otherwise 'retrying'.
async function markFailedAttempt(id, errorMessage, maxAttempts) {
  const { rows } = await pool.query(
    `UPDATE notification_deliveries
     SET attempt_count = attempt_count + 1,
         status = CASE WHEN attempt_count + 1 >= $3 THEN 'dead_letter' ELSE 'retrying' END,
         last_attempt_at = now(),
         last_error = $2
     WHERE id = $1
     RETURNING status`,
    [id, errorMessage, maxAttempts]
  );
  return rows[0].status;
}

async function listByTransfer(transferId) {
  const { rows } = await pool.query(
    `SELECT id, channel, status, attempt_count, last_attempt_at, last_error
     FROM notification_deliveries WHERE transfer_id = $1
     ORDER BY channel, id`,
    [transferId]
  );
  return rows;
}

module.exports = { createDelivery, markSent, markFailedAttempt, listByTransfer };