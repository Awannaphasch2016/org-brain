'use strict';

// ISS-007 acceptance tests (C-003, FR-003, FR-004, FR-012).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { createTaskService, TaskValidationError, UnknownMemberError } = require(path.join(SRC, 'tasks.js'));

const STATUSES = ['To Do', 'In Progress', 'Done'];

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-tasks-status-'));
  const dbPath = path.join(dir, 'store.db');
  const store = openStore(dbPath);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = addMember(store, { username: 'alice', displayName: 'Alice', password: 'pw', teamName: 'Core' });
  const b = addMember(store, { username: 'bob', displayName: 'Bob', password: 'pw' });
  return { store, dbPath, alice: a.member, bob: b.member, tasks: createTaskService(store) };
}

function readFromDisk(dbPath, id) {
  const other = openStore(dbPath);
  try {
    return other.getTask(id);
  } finally {
    other.close();
  }
}

test('status moves from each value to either of the other two, and each change is persisted', (t) => {
  const { dbPath, alice, bob, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Flow', description: 'd' });

  for (const from of STATUSES) {
    for (const to of STATUSES.filter((s) => s !== from)) {
      tasks.setStatus(alice.id, created.id, from);
      assert.equal(readFromDisk(dbPath, created.id).status, from);

      // Bob did not create the task. FR-012 means he may still change it.
      const updated = tasks.setStatus(bob.id, created.id, to);
      assert.equal(updated.status, to, `${from} -> ${to}`);
      const row = readFromDisk(dbPath, created.id);
      assert.equal(row.status, to, `${from} -> ${to} persisted`);
      assert.equal(row.title, 'Flow');
      assert.equal(row.description, 'd');
      assert.equal(row.assignee_id, null);
    }
  }
});

test('any other status value is rejected and leaves the task unchanged', (t) => {
  const { store, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  tasks.setStatus(alice.id, created.id, 'In Progress');
  const before = store.getTask(created.id);
  for (const bad of ['Blocked', 'done', 'to do', 'IN PROGRESS', ' Done', 'Done ', '', null, undefined, 1, ['Done']]) {
    assert.throws(() => tasks.setStatus(alice.id, created.id, bad), TaskValidationError, String(bad));
  }
  assert.deepEqual(store.getTask(created.id), before);
});

test('the store also refuses an unknown status', (t) => {
  const { store, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  assert.throws(() => store.updateTaskStatus(created.id, 'Blocked'), TypeError);
  assert.equal(store.updateTaskStatus(999, 'Done'), null);
  assert.equal(store.getTask(created.id).status, 'To Do');
});

test('missing tasks return null and unknown callers are refused', (t) => {
  const { store, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  for (const id of [999, 0, '1', null]) {
    assert.equal(tasks.setStatus(alice.id, id, 'Done'), null);
  }
  assert.throws(() => tasks.setStatus(999, created.id, 'Done'), UnknownMemberError);
  assert.equal(store.getTask(created.id).status, 'To Do');
});
