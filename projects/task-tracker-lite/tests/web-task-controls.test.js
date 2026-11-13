'use strict';

// ISS-011 acceptance tests (C-001, FR-003, FR-005, FR-006, FR-007, FR-017, NFR-002).
// These tests check, over real HTTP, the HTML a standard browser would receive. They
// submit the same forms a browser would, then reload the page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { hashPassword } = require(path.join(SRC, 'password.js'));
const { createTaskService } = require(path.join(SRC, 'tasks.js'));
const { start } = require(path.join(SRC, 'server.js'));

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-web-controls-'));
  const db = path.join(dir, 'store.db');
  const seed = openStore(db);
  const a = addMember(seed, { username: 'alice', displayName: 'Alice', password: 'alice-pass', teamName: 'Core' });
  const b = addMember(seed, { username: 'bob', displayName: 'Bob', password: 'bob-pass' });
  const c = addMember(seed, { username: 'carol', displayName: 'Carol', password: 'carol-pass' });
  // add-member never creates a second team. The test builds one directly in the store
  // to get a member who is outside the task's team.
  const other = seed.createTeam({ name: 'Elsewhere' });
  const outsider = seed.createMember({ teamId: other.id, username: 'olga', displayName: 'Olga', passwordHash: hashPassword('olga-pass') });
  const task = createTaskService(seed).create(a.member.id, { title: 'Original', description: 'Old text' });
  seed.close();

  const server = await start({ db, port: 0, host: '127.0.0.1', secureCookies: false });
  const store = openStore(db);
  t.after(async () => {
    store.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { port: server.address().port, store, task, alice: a.member, bob: b.member, carol: c.member, outsider };
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

function selectOptions(html, name) {
  const select = new RegExp(`<select id="${name}" name="${name}">([\\s\\S]*?)</select>`).exec(html);
  assert.ok(select, `select ${name} present`);
  return [...select[1].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)]
    .map(([, value, selected, label]) => ({ value, label, selected: Boolean(selected) }));
}

// Submits a form, expects the redirect back to the detail page, then reloads that page.
async function submitAndReload(port, cookie, action, form, taskId) {
  const res = await request(port, 'POST', action, { cookie, form });
  assert.equal(res.status, 303, `${action} ${JSON.stringify(form)}`);
  assert.equal(res.headers.location, `/tasks/${taskId}`);
  const page = await request(port, 'GET', `/tasks/${taskId}`, { cookie });
  assert.equal(page.status, 200);
  return page.body;
}

test('the detail page offers edit, status, and assignee controls as plain HTML forms', async (t) => {
  const { port, task, alice, bob, carol } = await setup(t);
  const cookie = await signIn(port, 'bob');
  const res = await request(port, 'GET', `/tasks/${task.id}`, { cookie });
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body, /<script/i);

  assert.match(res.body, new RegExp(`<form method="post" action="/tasks/${task.id}/edit" id="edit-form">`));
  assert.match(res.body, /<input id="edit-title" name="title" value="Original" required>/);
  assert.match(res.body, /<textarea id="edit-description" name="description" rows="6">Old text<\/textarea>/);

  assert.match(res.body, new RegExp(`<form method="post" action="/tasks/${task.id}/status" id="status-form">`));
  assert.deepEqual(selectOptions(res.body, 'status'), [
    { value: 'To Do', label: 'To Do', selected: true },
    { value: 'In Progress', label: 'In Progress', selected: false },
    { value: 'Done', label: 'Done', selected: false },
  ]);

  assert.match(res.body, new RegExp(`<form method="post" action="/tasks/${task.id}/assignee" id="assignee-form">`));
  assert.deepEqual(selectOptions(res.body, 'assignee'), [
    { value: '', label: 'unassigned', selected: true },
    { value: String(alice.id), label: 'Alice', selected: false },
    { value: String(bob.id), label: 'Bob', selected: false },
    { value: String(carol.id), label: 'Carol', selected: false },
  ]);
  assert.doesNotMatch(res.body, /Olga/, 'members of other teams are not offered');
  assert.doesNotMatch(res.body, /<select[^>]*multiple/, 'only one assignee can be chosen');
});

test('editing title and description is shown on reload', async (t) => {
  const { port, store, task } = await setup(t);
  const cookie = await signIn(port, 'bob');
  const body = await submitAndReload(port, cookie, `/tasks/${task.id}/edit`, { title: 'Renamed', description: 'New\ntext' }, task.id);
  assert.match(body, /<h1 id="task-title">Renamed<\/h1>/);
  assert.match(body, /<p id="task-description"[^>]*>New\ntext<\/p>/);
  assert.match(body, /<input id="edit-title" name="title" value="Renamed" required>/);
  assert.equal(store.getTask(task.id).title, 'Renamed');

  const list = await request(port, 'GET', '/', { cookie });
  assert.ok(list.body.includes(`<a href="/tasks/${task.id}">Renamed</a>`));
});

test('every status choice is applied and shown on reload', async (t) => {
  const { port, store, task } = await setup(t);
  const cookie = await signIn(port, 'alice');
  for (const status of ['In Progress', 'Done', 'To Do', 'Done', 'In Progress', 'To Do']) {
    const body = await submitAndReload(port, cookie, `/tasks/${task.id}/status`, { status }, task.id);
    assert.match(body, new RegExp(`<dd id="task-status">${status}</dd>`));
    assert.deepEqual(selectOptions(body, 'status').filter((o) => o.selected).map((o) => o.value), [status]);
    assert.equal(store.getTask(task.id).status, status);
  }
});

test('the assignee can be set to one team member or cleared, and is shown on reload', async (t) => {
  const { port, store, task, bob, carol } = await setup(t);
  const cookie = await signIn(port, 'alice');

  let body = await submitAndReload(port, cookie, `/tasks/${task.id}/assignee`, { assignee: String(bob.id) }, task.id);
  assert.match(body, /<dd id="task-assignee">Bob<\/dd>/);
  assert.deepEqual(selectOptions(body, 'assignee').filter((o) => o.selected).map((o) => o.label), ['Bob']);

  body = await submitAndReload(port, cookie, `/tasks/${task.id}/assignee`, { assignee: String(carol.id) }, task.id);
  assert.match(body, /<dd id="task-assignee">Carol<\/dd>/);
  assert.equal(store.getTask(task.id).assignee_id, carol.id);

  body = await submitAndReload(port, cookie, `/tasks/${task.id}/assignee`, { assignee: '' }, task.id);
  assert.match(body, /<dd id="task-assignee">unassigned<\/dd>/);
  assert.deepEqual(selectOptions(body, 'assignee').filter((o) => o.selected).map((o) => o.label), ['unassigned']);
  assert.equal(store.getTask(task.id).assignee_id, null);

  const list = await request(port, 'GET', '/', { cookie });
  assert.match(list.body, /<td>unassigned<\/td>/);
});

test('rejected values show an error and leave the task unchanged', async (t) => {
  const { port, store, task, bob, outsider } = await setup(t);
  const cookie = await signIn(port, 'alice');
  await submitAndReload(port, cookie, `/tasks/${task.id}/assignee`, { assignee: String(bob.id) }, task.id);
  const before = store.getTask(task.id);

  const cases = [
    [`/tasks/${task.id}/edit`, { title: '   ', description: 'kept <draft>' }, /Title is required\./],
    [`/tasks/${task.id}/edit`, { description: 'no title field' }, /Title is required\./],
    [`/tasks/${task.id}/status`, { status: 'Blocked' }, /Status must be one of: To Do, In Progress, Done\./],
    [`/tasks/${task.id}/status`, { status: 'done' }, /Status must be one of/],
    [`/tasks/${task.id}/status`, {}, /Status must be one of/],
    [`/tasks/${task.id}/assignee`, { assignee: String(outsider.id) }, /Assignee must be unassigned or a member of the team\./],
    [`/tasks/${task.id}/assignee`, { assignee: '999' }, /Assignee must be/],
    [`/tasks/${task.id}/assignee`, { assignee: 'bob' }, /Assignee must be/],
    [`/tasks/${task.id}/assignee`, {}, /Assignee must be/],
  ];
  for (const [action, form, message] of cases) {
    const res = await request(port, 'POST', action, { cookie, form });
    assert.equal(res.status, 400, `${action} ${JSON.stringify(form)}`);
    assert.match(res.body, message);
    assert.deepEqual(store.getTask(task.id), before, `${action} ${JSON.stringify(form)} left the task unchanged`);
  }

  // A failed edit keeps what was typed so it can be fixed, and the text is escaped.
  const failed = await request(port, 'POST', `/tasks/${task.id}/edit`, { cookie, form: { title: '', description: 'kept <draft>' } });
  assert.match(failed.body, /<textarea id="edit-description" name="description" rows="6">kept &lt;draft&gt;<\/textarea>/);

  // Repeated values in one form (multiple assignees) are refused too.
  const multi = await request(port, 'POST', `/tasks/${task.id}/assignee`, { cookie, form: new URLSearchParams([['assignee', 'x'], ['assignee', String(bob.id)]]) });
  assert.equal(multi.status, 400);
  assert.deepEqual(store.getTask(task.id), before);
});

test('changes to missing tasks get a not-found page, and the controls need sign-in', async (t) => {
  const { port, store, task } = await setup(t);
  const cookie = await signIn(port, 'alice');
  for (const action of ['/tasks/999/edit', '/tasks/999/status', '/tasks/999/assignee']) {
    const res = await request(port, 'POST', action, { cookie, form: { title: 'x', status: 'Done', assignee: '' } });
    assert.equal(res.status, 404, action);
  }

  const before = store.getTask(task.id);
  for (const action of ['edit', 'status', 'assignee']) {
    const res = await request(port, 'POST', `/tasks/${task.id}/${action}`, { form: { title: 'x', status: 'Done', assignee: '' } });
    assert.equal(res.status, 401, action);
  }
  assert.deepEqual(store.getTask(task.id), before);
});

test("a member of another team cannot change the team's tasks", async (t) => {
  const { port, store, task } = await setup(t);
  const cookie = await signIn(port, 'olga');
  const before = store.getTask(task.id);
  assert.equal((await request(port, 'GET', `/tasks/${task.id}`, { cookie })).status, 404);
  for (const [action, form] of [['edit', { title: 'x' }], ['status', { status: 'Done' }], ['assignee', { assignee: '' }]]) {
    assert.equal((await request(port, 'POST', `/tasks/${task.id}/${action}`, { cookie, form })).status, 404, action);
  }
  assert.deepEqual(store.getTask(task.id), before);
});
