'use strict';

// ISS-010 acceptance tests (C-001, FR-001, FR-002, FR-008, FR-009, FR-017, NFR-002).
// These tests check, over real HTTP, the HTML a standard browser would receive.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { createTaskService } = require(path.join(SRC, 'tasks.js'));
const { start } = require(path.join(SRC, 'server.js'));

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-web-tasks-'));
  const db = path.join(dir, 'store.db');
  const seed = openStore(db);
  const a = addMember(seed, { username: 'alice', displayName: 'Alice', password: 'alice-pass', teamName: 'Core' });
  const b = addMember(seed, { username: 'bob', displayName: 'Bob', password: 'bob-pass' });
  seed.close();
  const server = await start({ db, port: 0, host: '127.0.0.1', secureCookies: false });
  // A second connection lets the tests inspect and arrange data directly.
  const store = openStore(db);
  t.after(async () => {
    store.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = server.address().port;
  return { port, store, alice: a.member, bob: b.member, team: a.team };
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

async function signIn(port, username) {
  const res = await request(port, 'POST', '/login', { form: { username, password: `${username}-pass` } });
  assert.equal(res.status, 303);
  return [].concat(res.headers['set-cookie']).find((c) => c.startsWith('sid=')).split(';')[0];
}

function rows(html) {
  return [...html.matchAll(/<tr><td><a href="\/tasks\/(\d+)">(.*?)<\/a><\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)]
    .map(([, id, title, status, assignee]) => ({ id: Number(id), title, status, assignee }));
}

test('a signed-in member sees the task list with title, status, and assignee or "unassigned"', async (t) => {
  const { port, store, alice, bob } = await setup(t);
  const cookie = await signIn(port, 'alice');

  const empty = await request(port, 'GET', '/', { cookie });
  assert.equal(empty.status, 200);
  assert.match(empty.body, /No tasks yet\./);
  assert.match(empty.body, /<a href="\/tasks\/new" id="new-task">New task<\/a>/);

  const service = createTaskService(store);
  const one = service.create(alice.id, { title: 'Write spec' });
  const two = service.create(bob.id, { title: 'Review spec' });
  service.setAssignee(alice.id, two.id, bob.id);
  service.setStatus(alice.id, two.id, 'In Progress');

  for (const p of ['/', '/tasks']) {
    const res = await request(port, 'GET', p, { cookie });
    assert.equal(res.status, 200, p);
    assert.match(res.body, /<th>Title<\/th><th>Status<\/th><th>Assignee<\/th>/);
    assert.deepEqual(rows(res.body), [
      { id: one.id, title: 'Write spec', status: 'To Do', assignee: 'unassigned' },
      { id: two.id, title: 'Review spec', status: 'In Progress', assignee: 'Bob' },
    ]);
  }
});

test("a member opens a task's detail page showing title, description, status, and assignee", async (t) => {
  const { port, store, alice, bob } = await setup(t);
  const service = createTaskService(store);
  const task = service.create(alice.id, { title: 'Ship it', description: 'Line one\nLine two' });
  service.setAssignee(alice.id, task.id, alice.id);
  service.setStatus(alice.id, task.id, 'Done');

  // Bob did not create the task and can still open it (FR-012).
  const cookie = await signIn(port, 'bob');
  const list = await request(port, 'GET', '/', { cookie });
  assert.ok(list.body.includes(`<a href="/tasks/${task.id}">Ship it</a>`));

  const res = await request(port, 'GET', `/tasks/${task.id}`, { cookie });
  assert.equal(res.status, 200);
  assert.match(res.body, /<h1 id="task-title">Ship it<\/h1>/);
  assert.match(res.body, /<p id="task-description"[^>]*>Line one\nLine two<\/p>/);
  assert.match(res.body, /<dd id="task-status">Done<\/dd>/);
  assert.match(res.body, /<dd id="task-assignee">Alice<\/dd>/);
  assert.match(res.body, /Signed in as Bob/);

  const bare = service.create(bob.id, { title: 'Bare' });
  const bareRes = await request(port, 'GET', `/tasks/${bare.id}`, { cookie });
  assert.match(bareRes.body, /<dd id="task-status">To Do<\/dd>/);
  assert.match(bareRes.body, /<dd id="task-assignee">unassigned<\/dd>/);
  assert.match(bareRes.body, /No description/);
});

test('a member creates a task from a form, and it appears in the list as To Do and unassigned', async (t) => {
  const { port, store, team } = await setup(t);
  const cookie = await signIn(port, 'alice');

  const form = await request(port, 'GET', '/tasks/new', { cookie });
  assert.equal(form.status, 200);
  assert.match(form.body, /<form method="post" action="\/tasks">/);
  assert.match(form.body, /<input id="title" name="title" value="" required>/);
  assert.match(form.body, /<textarea id="description" name="description"/);
  assert.match(form.body, /<button type="submit">Create task<\/button>/);

  const created = await request(port, 'POST', '/tasks', { cookie, form: { title: 'From the form', description: 'Typed in a browser' } });
  assert.equal(created.status, 303);
  assert.equal(created.headers.location, '/');

  const list = await request(port, 'GET', '/', { cookie });
  const listed = rows(list.body);
  assert.equal(listed.length, 1);
  const [row] = listed;
  assert.equal(row.title, 'From the form');
  assert.equal(row.status, 'To Do');
  assert.equal(row.assignee, 'unassigned');

  const stored = store.listTasks(team.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].description, 'Typed in a browser');
  assert.equal(stored[0].assignee_id, null);

  const detail = await request(port, 'GET', `/tasks/${row.id}`, { cookie });
  assert.match(detail.body, /Typed in a browser/);
});

test('submitting the form without a title shows an error and stores nothing', async (t) => {
  const { port, store, team } = await setup(t);
  const cookie = await signIn(port, 'alice');
  for (const title of ['', '   ']) {
    const res = await request(port, 'POST', '/tasks', { cookie, form: { title, description: 'keep <this>' } });
    assert.equal(res.status, 400);
    assert.match(res.body, /Title is required\./);
    assert.match(res.body, /<textarea id="description" name="description" rows="6">keep &lt;this&gt;<\/textarea>/);
  }
  const noField = await request(port, 'POST', '/tasks', { cookie, form: { description: 'x' } });
  assert.equal(noField.status, 400);
  assert.deepEqual(store.listTasks(team.id), []);
});

test('task text is HTML-escaped on every page', async (t) => {
  const { port, store, alice } = await setup(t);
  const evil = '<img src=x onerror=alert(1)>';
  const task = createTaskService(store).create(alice.id, { title: evil, description: evil });
  const cookie = await signIn(port, 'alice');
  for (const p of ['/', `/tasks/${task.id}`]) {
    const res = await request(port, 'GET', p, { cookie });
    assert.doesNotMatch(res.body, /<img src=x/, p);
    assert.ok(res.body.includes('&lt;img src=x onerror=alert(1)&gt;'), p);
  }
});

test('unknown or malformed task ids get a not-found page', async (t) => {
  const { port } = await setup(t);
  const cookie = await signIn(port, 'alice');
  for (const p of ['/tasks/999', '/tasks/0', '/tasks/abc', '/tasks/1.5', '/tasks/-1', '/tasks/1/extra']) {
    assert.equal((await request(port, 'GET', p, { cookie })).status, 404, p);
  }
});

test('the task pages are behind sign-in', async (t) => {
  const { port, store, alice, team } = await setup(t);
  const task = createTaskService(store).create(alice.id, { title: 'Private' });
  for (const p of ['/', '/tasks', '/tasks/new', `/tasks/${task.id}`]) {
    const res = await request(port, 'GET', p);
    assert.equal(res.status, 303, p);
    assert.equal(res.headers.location, '/login');
  }
  assert.equal((await request(port, 'POST', '/tasks', { form: { title: 'x' } })).status, 401);
  assert.equal(store.listTasks(team.id).length, 1);
});
