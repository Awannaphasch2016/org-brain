'use strict';

// ISS-009 acceptance tests (C-001, FR-010, FR-011, FR-013, FR-017, NFR-002).
// These tests check, over real HTTP, the HTML a standard browser would receive.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { start } = require(path.join(SRC, 'server.js'));
const { escapeHtml } = require(path.join(SRC, 'html.js'));

async function setup(t, { aliceName = 'Alice' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-web-auth-'));
  const db = path.join(dir, 'store.db');
  const seed = openStore(db);
  addMember(seed, { username: 'alice', displayName: aliceName, password: 'alice-pass', teamName: 'Core' });
  seed.close();
  const server = await start({ db, port: 0, host: '127.0.0.1', secureCookies: false });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, port: server.address().port };
}

function request(port, method, pathname, { cookie, form } = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : '';
    const headers = { Connection: 'close' };
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

function cookieFrom(res) {
  const set = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('sid='));
  return set ? set.split(';')[0] : null;
}

const REGISTRATION = /register|sign[\s-]?up|create (an )?account|new account/i;

test('the sign-in page is an HTML form a standard browser can submit, with no registration link', async (t) => {
  const { port } = await setup(t);
  const res = await request(port, 'GET', '/login');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html; charset=utf-8/);
  assert.match(res.body, /^<!doctype html>/);
  assert.match(res.body, /<form method="post" action="\/login">/);
  assert.match(res.body, /<input id="username" name="username"[^>]*required/);
  assert.match(res.body, /<input id="password" name="password" type="password"[^>]*required/);
  assert.match(res.body, /<button type="submit">Sign in<\/button>/);
  assert.doesNotMatch(res.body, /<script/i, 'works without client-side JavaScript');
  assert.doesNotMatch(res.body, REGISTRATION);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('a member signs in, sees a visible sign-out control, and signs out', async (t) => {
  const { port } = await setup(t);

  const login = await request(port, 'POST', '/login', { form: { username: 'alice', password: 'alice-pass' } });
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, '/');
  const cookie = cookieFrom(login);
  assert.ok(cookie);

  const home = await request(port, 'GET', '/', { cookie });
  assert.equal(home.status, 200);
  assert.match(home.body, /Signed in as Alice/);
  assert.match(home.body, /<form method="post" action="\/logout"[^>]*><button type="submit" id="sign-out">Sign out<\/button><\/form>/);
  assert.doesNotMatch(home.body, REGISTRATION);

  const out = await request(port, 'POST', '/logout', { cookie });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, '/login');

  const after = await request(port, 'GET', '/', { cookie });
  assert.equal(after.status, 303);
  assert.equal(after.headers.location, '/login');
});

test('wrong credentials show the sign-in page again with an error and no session', async (t) => {
  const { port } = await setup(t);
  const res = await request(port, 'POST', '/login', { form: { username: 'alice', password: 'nope' } });
  assert.equal(res.status, 401);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.body, /Incorrect username or password\./);
  assert.match(res.body, /<form method="post" action="\/login">/);
  assert.equal(cookieFrom(res), null);
});

test('requesting any task page while signed out leads to the sign-in page', async (t) => {
  const { port } = await setup(t);
  for (const p of ['/', '/tasks', '/tasks/new', '/tasks/1', '/tasks/1/edit', '/register', '/signup']) {
    const res = await request(port, 'GET', p);
    assert.equal(res.status, 303, p);
    assert.equal(res.headers.location, '/login', p);
  }
  for (const p of ['/tasks', '/tasks/1', '/register']) {
    assert.equal((await request(port, 'POST', p, { form: { title: 'x' } })).status, 401, `POST ${p}`);
  }
});

test('no registration page exists, even when signed in', async (t) => {
  const { db, port } = await setup(t);
  const cookie = cookieFrom(await request(port, 'POST', '/login', { form: { username: 'alice', password: 'alice-pass' } }));
  for (const p of ['/register', '/signup', '/sign-up', '/members/new']) {
    assert.equal((await request(port, 'GET', p, { cookie })).status, 404, `GET ${p}`);
  }
  const post = await request(port, 'POST', '/register', { cookie, form: { username: 'mallory', password: 'x' } });
  assert.equal(post.status, 404);
  const s = openStore(db);
  assert.equal(s.getMemberByUsername('mallory'), null);
  s.close();
});

test('member names are HTML-escaped', async (t) => {
  const { port } = await setup(t, { aliceName: '<script>alert(1)</script>' });
  const cookie = cookieFrom(await request(port, 'POST', '/login', { form: { username: 'alice', password: 'alice-pass' } }));
  const home = await request(port, 'GET', '/', { cookie });
  assert.doesNotMatch(home.body, /<script>alert/);
  assert.ok(home.body.includes(escapeHtml('<script>alert(1)</script>')));
});

test('the server command starts and serves the sign-in page', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-web-cli-'));
  const db = path.join(dir, 'store.db');
  const child = spawn(process.execPath, [path.join(SRC, 'server.js'), '--db', db, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const line = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes('\n')) resolve(out.trim());
    });
    child.on('exit', (code) => reject(new Error(`server exited early with ${code}`)));
  });
  const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)$/.exec(line);
  assert.ok(m, line);
  const res = await request(Number(m[1]), 'GET', '/login');
  assert.equal(res.status, 200);
  assert.match(res.body, /<h1>Sign in<\/h1>/);
});
