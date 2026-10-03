const pool = require('../src/config/database');

const seedUsers = [
  { name: 'Alice Seed', email: 'alice@seed.test', balances: { NGN: '500000', CAD: '1000' } },
  { name: 'Bob Seed', email: 'bob@seed.test', balances: { NGN: '250000', CAD: '500' } },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of seedUsers) {
      await client.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, 'seed-placeholder-hash')
         ON CONFLICT (email) DO NOTHING`,
        [u.name, u.email]
      );
      const { rows } = await client.query('SELECT id FROM users WHERE email = $1', [u.email]);
      for (const [currency, balance] of Object.entries(u.balances)) {
        await client.query(
          `INSERT INTO accounts (user_id, currency, cached_balance)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, currency) DO NOTHING`,
          [rows[0].id, currency, balance]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => {
    console.log('Seeded');
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });