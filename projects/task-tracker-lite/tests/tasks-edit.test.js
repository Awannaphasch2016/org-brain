'use strict';

// ISS-006 acceptance tests (C-003, FR-007, FR-012).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { createTaskService, TaskValidationError, UnknownMemberError } = require(path.join(SRC, 'tasks.js'));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-tasks-edit-'));
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

test("any member can change a task's title and description, and the change is persisted", (t) => {
  const { dbPath, alice, bob, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Draft', description: 'old' });

  // Bob did not create the task. FR-012 means he may still edit it.
  const edited = tasks.edit(bob.id, created.id, { title: 'Final', description: 'new text' });
  assert.deepEqual(edited, {
    id: created.id,
    title: 'Final',
    description: 'new text',
    status: 'To Do',
    assignee: null,
    assigneeLabel: 'unassigned',
  });

  // The change is in the database file: a separate connection reads it back.
  const other = openStore(dbPath);
  const row = other.getTask(created.id);
  other.close();
  assert.equal(row.title, 'Final');
  assert.equal(row.description, 'new text');
  assert.equal(row.status, 'To Do');
  assert.equal(row.assignee_id, null);
});

test('the description can be cleared, or kept by leaving it out', (t) => {
  const { alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'T', description: 'keep me' });
  assert.equal(tasks.edit(alice.id, created.id, { title: 'T2' }).description, 'keep me');
  assert.equal(tasks.edit(alice.id, created.id, { title: 'T3', description: '' }).description, '');
});

test('an edit with an empty title is rejected and leaves the task unchanged', (t) => {
  const { store, alice, bob, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep', description: 'same' });
  const before = store.getTask(created.id);
  for (const input of [{ title: '' }, { title: '   ' }, { description: 'x' }, { title: 3 }, {}, undefined]) {
    assert.throws(() => tasks.edit(bob.id, created.id, input), TaskValidationError);
  }
  assert.throws(() => tasks.edit(bob.id, created.id, { title: 'ok', description: 9 }), TaskValidationError);
  assert.deepEqual(store.getTask(created.id), before);
});

test('editing a missing task returns null, and unknown callers are refused', (t) => {
  const { store, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  const before = store.getTask(created.id);
  for (const id of [999, 0, '1', null]) {
    assert.equal(tasks.edit(alice.id, id, { title: 'x' }), null);
  }
  assert.throws(() => tasks.edit(999, created.id, { title: 'x' }), UnknownMemberError);
  assert.deepEqual(store.getTask(created.id), before);
});
