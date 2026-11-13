'use strict';

// Salted password hashing for member accounts (ISS-002, FR-015).
// Format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>

const crypto = require('node:crypto');

const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password is required');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = crypto.scryptSync(password, salt, KEY_BYTES, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || expected.length === 0) {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
