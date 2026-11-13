'use strict';

// ISS-004: Authentication and session handling (C-002, FR-010, FR-011, NFR-001).
// A session holds only the signed-in member's id. Sessions are kept in memory and
// identified by a random 256-bit token, so a process restart signs everyone out.

const crypto = require('node:crypto');
const { verifyPassword, hashPassword } = require('./password');

// Used when the username is unknown, so a wrong username and a wrong password take
// about the same time to reject.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function createAuth(store) {
  const sessions = new Map(); // token -> frozen { memberId }

  return Object.freeze({
    // Returns a new session token on success, or null when the credentials are wrong.
    signIn(username, password) {
      if (typeof username !== 'string' || typeof password !== 'string' || username === '' || password === '') {
        return null;
      }
      const member = store.getMemberByUsername(username);
      const ok = verifyPassword(password, member ? member.password_hash : DUMMY_HASH);
      if (!member || !ok) return null;
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, Object.freeze({ memberId: member.id }));
      return token;
    },

    // Returns the session ({ memberId }) for a valid token, otherwise null.
    sessionFor(token) {
      if (typeof token !== 'string') return null;
      const session = sessions.get(token);
      if (!session) return null;
      if (store.getMember(session.memberId) === null) {
        sessions.delete(token);
        return null;
      }
      return session;
    },

    signOut(token) {
      if (typeof token === 'string') sessions.delete(token);
    },
  });
}

module.exports = { createAuth };
