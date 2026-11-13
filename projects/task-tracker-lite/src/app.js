'use strict';

// ISS-004: HTTP request handling with a session gate (C-002, FR-010, FR-011, NFR-001).
// Public routes: GET /login and POST /login only. Every other request needs a valid
// session. Without one, GET and HEAD requests are redirected to /login and all other
// methods get 401. Pages and task routes are added by later issues through `routes`.

const { createAuth } = require('./auth');

const COOKIE_NAME = 'sid';
const MAX_FORM_BYTES = 8 * 1024;

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionCookie(token, { secure }) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attrs.push('Secure');
  if (token === null) return `${COOKIE_NAME}=; ${attrs.join('; ')}; Max-Age=0`;
  return `${COOKIE_NAME}=${token}; ${attrs.join('; ')}`;
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_FORM_BYTES) chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_FORM_BYTES) {
        reject(Object.assign(new Error('Form too large'), { status: 413 }));
        return;
      }
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  send(res, 303, '', { Location: location, ...headers });
}

// routes: { 'GET /path': (req, res, ctx) => …, … }. These are protected routes.
// ctx is { session, form() }, and session is a frozen { memberId }.
function createApp({ store, routes = {}, loginPage, secureCookies = false } = {}) {
  if (!store) throw new TypeError('store is required');
  const auth = createAuth(store);
  const cookieOpts = { secure: secureCookies };
  const renderLogin = loginPage || ((req, res, { failed }) => send(res, failed ? 401 : 200, failed ? 'Sign-in failed\n' : 'Sign in\n'));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    if (key === 'GET /login') return renderLogin(req, res, { failed: false });
    if (key === 'POST /login') {
      const form = await readForm(req);
      const token = auth.signIn(form.get('username') || '', form.get('password') || '');
      if (token === null) return renderLogin(req, res, { failed: true });
      return redirect(res, '/', { 'Set-Cookie': sessionCookie(token, cookieOpts) });
    }

    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const session = auth.sessionFor(token);
    if (session === null) {
      if (req.method === 'GET' || req.method === 'HEAD') return redirect(res, '/login');
      return send(res, 401, 'Sign-in required\n');
    }

    if (key === 'POST /logout') {
      auth.signOut(token);
      return redirect(res, '/login', { 'Set-Cookie': sessionCookie(null, cookieOpts) });
    }

    const route = routes[key];
    if (!route) return send(res, 404, 'Not found\n');
    return route(req, res, { session, form: () => readForm(req) });
  }

  return function requestListener(req, res) {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy();
      send(res, err.status || 500, err.status ? `${err.message}\n` : 'Internal error\n');
    });
  };
}

module.exports = { createApp, COOKIE_NAME };
