const bcrypt = require('bcrypt');
const pool = require('../../config/database');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../config/env');

const SALT_ROUNDS = 10;

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

async function signup({ name, email, phone, password }) {
  const hash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, created_at`,
      [name, email, phone || null, hash]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Email already registered');
      e.status = 409;
      e.code = 'EMAIL_TAKEN';
      throw e;
    }
    throw err;
  }
}

async function login({ email, password }) {
  const { rows } = await pool.query(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    const e = new Error('Invalid email or password');
    e.status = 401;
    e.code = 'INVALID_CREDENTIALS';
    throw e;
  }
  return { token: jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '1h' }) };
}

module.exports = { hashPassword, verifyPassword, signup, login };