'use strict';

// ISS-005 acceptance tests (C-003, FR-001, FR-002, FR-005, FR-008, FR-009, FR-012).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { createTaskService, TaskValidationError, UnknownMemberError } = require(path.join(SRC, 'tasks.js'));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-tasks-'));
  const dbPath = path.join(dir, 'store.db');
  const store = openStore(dbPath);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = addMember(store, { username: 'alice', displayName: 'Alice', password: 'pw', teamName: 'Core' });
  const b = addMember(store, { username: 'bob', displayName: 'Bob', password: 'pw' });
  return { store, dbPath, team: a.team, alice: a.member, bob: b.member, tasks: createTaskService(store) };
}

test("create stores the task in the caller's team as To Do and unassigned", (t) => {
  const { store, team, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Write spec', description: 'First draft' });
  assert.deepEqual(created, {
    id: created.id,
    title: 'Write spec',
    description: 'First draft',
    status: 'To Do',
    assignee: null,
    assigneeLabel: 'unassigned',
  });
  assert.deepEqual(store.getTask(created.id), {
    id: created.id,
    team_id: team.id,
    title: 'Write spec',
    description: 'First draft',
    status: 'To Do',
    assignee_id: null,
  });

  const bare = tasks.create(alice.id, { title: 'No description' });
  assert.equal(bare.description, '');
  assert.equal(bare.status, 'To Do');
});

test('create without a title is rejected and stores nothing', (t) => {
  const { store, team, alice, tasks } = setup(t);
  for (const input of [{}, { title: '' }, { title: '   ' }, { title: 7 }, { description: 'only text' }, undefined]) {
    assert.throws(() => tasks.create(alice.id, input), TaskValidationError);
  }
  assert.throws(() => tasks.create(alice.id, { title: 'ok', description: 5 }), TaskValidationError);
  assert.deepEqual(store.listTasks(team.id), []);
});

test('list returns every task with title, status, and assignee or "unassigned"', (t) => {
  const { dbPath, alice, bob, tasks } = setup(t);
  const one = tasks.create(alice.id, { title: 'One', description: 'd1' });
  const two = tasks.create(bob.id, { title: 'Two' });

  // ISS-008 adds the assignee operation. Until then, set an assignee directly in the database.
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(bob.id, two.id);
  db.close();

  const expected = [
    { id: one.id, title: 'One', status: 'To Do', assignee: null, assigneeLabel: 'unassigned' },
    { id: two.id, title: 'Two', status: 'To Do', assignee: { id: bob.id, display_name: 'Bob' }, assigneeLabel: 'Bob' },
  ];
  assert.deepEqual(tasks.list(alice.id), expected);
  assert.deepEqual(tasks.list(bob.id), expected);
  for (const row of tasks.list(alice.id)) assert.equal('description' in row, false);
});

test("view returns one task's title, description, status, and assignee", (t) => {
  const { alice, bob, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Spec', description: 'Long text' });
  assert.deepEqual(tasks.view(bob.id, created.id), {
    id: created.id,
    title: 'Spec',
    description: 'Long text',
    status: 'To Do',
    assignee: null,
    assigneeLabel: 'unassigned',
  });
  for (const id of [999, 0, '1', null, 1.5]) assert.equal(tasks.view(alice.id, id), null);
});

test('any member can create, list, and view with no role or per-task check', (t) => {
  const { alice, bob, tasks } = setup(t);
  const byAlice = tasks.create(alice.id, { title: 'By Alice' });
  const byBob = tasks.create(bob.id, { title: 'By Bob' });
  for (const me of [alice, bob]) {
    assert.deepEqual(tasks.list(me.id).map((x) => x.id), [byAlice.id, byBob.id]);
    assert.equal(tasks.view(me.id, byAlice.id).title, 'By Alice');
    assert.equal(tasks.view(me.id, byBob.id).title, 'By Bob');
  }
});

test('unknown callers are refused', (t) => {
  const { store, team, tasks } = setup(t);
  for (const id of [999, null, undefined, '1']) {
    assert.throws(() => tasks.create(id, { title: 'x' }), UnknownMemberError);
    assert.throws(() => tasks.list(id), UnknownMemberError);
    assert.throws(() => tasks.view(id, 1), UnknownMemberError);
  }
  assert.deepEqual(store.listTasks(team.id), []);
});

test('the service has no delete operation', (t) => {
  const { tasks } = setup(t);
  assert.deepEqual(Object.keys(tasks).sort(), ['create', 'edit', 'list', 'setStatus', 'view']);
});
