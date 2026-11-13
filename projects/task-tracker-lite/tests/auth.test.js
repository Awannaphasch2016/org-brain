'use strict';

// ISS-004 acceptance tests (C-002, FR-010, FR-011, NFR-001).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { createApp, COOKIE_NAME } = require(path.join(SRC, 'app.js'));
const { createAuth } = require(path.join(SRC, 'auth.js'));

// Creates members with the real add-member command, then starts the app on a loopback port.
async function setup(t, routes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-auth-'));
  const db = path.join(dir, 'store.db');
  for (const [u, extra] of [['alice', ['--team-name', 'Core']], ['bob', []]]) {
    const r = spawnSync(process.execPath, [path.join(SRC, 'add-member.js'), '--db', db, '--username', u, '--display-name', u, ...extra], {
      input: `${u}-pass\n`,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  }
  const store = openStore(db);
  const server = http.createServer(createApp({ store, routes }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, port: server.address().port };
}

function request(port, method, pathname, { cookie, form } = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : '';
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function sessionCookieFrom(res) {
  const set = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return set ? set.split(';')[0] : null;
}

const whoami = { 'GET /whoami': (req, res, { session }) => res.end(JSON.stringify(session)) };

test('a member created by add-member signs in and the session holds only their member id', async (t) => {
  const { store, port } = await setup(t, whoami);
  const res = await request(port, 'POST', '/login', { form: { username: 'alice', password: 'alice-pass' } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/');
  const setCookie = [].concat(res.headers['set-cookie'])[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = sessionCookieFrom(res);
  const me = await request(port, 'GET', '/whoami', { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(JSON.parse(me.body), { memberId: store.getMemberByUsername('alice').id });
});

test('wrong credentials are rejected and grant no session', async (t) => {
  const { port } = await setup(t, whoami);
  for (const form of [
    { username: 'alice', password: 'wrong' },
    { username: 'alice', password: 'bob-pass' },
    { username: 'nobody', password: 'alice-pass' },
    { username: 'alice', password: '' },
    {},
  ]) {
    const res = await request(port, 'POST', '/login', { form });
    assert.equal(res.status, 401, JSON.stringify(form));
    assert.equal(sessionCookieFrom(res), null);
  }
});

test('after sign-out the session no longer grants access', async (t) => {
  const { port } = await setup(t, whoami);
  const login = await request(port, 'POST', '/login', { form: { username: 'bob', password: 'bob-pass' } });
  const cookie = sessionCookieFrom(login);
  assert.equal((await request(port, 'GET', '/whoami', { cookie })).status, 200);

  const out = await request(port, 'POST', '/logout', { cookie });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, '/login');
  assert.match([].concat(out.headers['set-cookie'])[0], /Max-Age=0/);

  const after = await request(port, 'GET', '/whoami', { cookie });
  assert.equal(after.status, 303);
  assert.equal(after.headers.location, '/login');
  assert.equal((await request(port, 'POST', '/logout', { cookie })).status, 401);
});

test('every request except GET and POST /login needs a valid session', async (t) => {
  const touched = [];
  const routes = {
    'GET /': () => touched.push('GET /'),
    'GET /tasks': () => touched.push('GET /tasks'),
    'POST /tasks': () => touched.push('POST /tasks'),
  };
  const { port } = await setup(t, routes);

  assert.equal((await request(port, 'GET', '/login')).status, 200);

  for (const cookie of [undefined, `${COOKIE_NAME}=forged-token`, `${COOKIE_NAME}=`, 'other=1']) {
    for (const p of ['/', '/tasks', '/whoami', '/anything', '/login/extra']) {
      const res = await request(port, 'GET', p, { cookie });
      assert.equal(res.status, 303, `GET ${p}`);
      assert.equal(res.headers.location, '/login');
    }
    for (const [m, p] of [['POST', '/tasks'], ['POST', '/logout'], ['PUT', '/tasks'], ['DELETE', '/tasks'], ['PUT', '/login']]) {
      assert.equal((await request(port, m, p, { cookie })).status, 401, `${m} ${p}`);
    }
  }
  assert.deepEqual(touched, [], 'no protected handler ran without a session');
});

test('each sign-in issues a new random token', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-auth-unit-'));
  const store = openStore(path.join(dir, 'store.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { addMember } = require(path.join(SRC, 'add-member.js'));
  addMember(store, { username: 'alice', displayName: 'Alice', password: 'pw', teamName: 'Core' });

  const auth = createAuth(store);
  const a = auth.signIn('alice', 'pw');
  const b = auth.signIn('alice', 'pw');
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  auth.signOut(a);
  assert.equal(auth.sessionFor(a), null);
  assert.deepEqual(auth.sessionFor(b), { memberId: store.getMemberByUsername('alice').id });
  assert.ok(Object.isFrozen(auth.sessionFor(b)));
});
