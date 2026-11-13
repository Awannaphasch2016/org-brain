'use strict';

// ISS-008 acceptance tests (C-003, FR-005, FR-006, FR-012, FR-014).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { hashPassword } = require(path.join(SRC, 'password.js'));
const { createTaskService, TaskValidationError, UnknownMemberError } = require(path.join(SRC, 'tasks.js'));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-tasks-assignee-'));
  const dbPath = path.join(dir, 'store.db');
  const store = openStore(dbPath);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = addMember(store, { username: 'alice', displayName: 'Alice', password: 'pw', teamName: 'Core' });
  const b = addMember(store, { username: 'bob', displayName: 'Bob', password: 'pw' });
  const c = addMember(store, { username: 'carol', displayName: 'Carol', password: 'pw' });

  // add-member never creates a second team. The test builds one directly in the store
  // to get a member who is outside the task's team.
  const otherTeam = store.createTeam({ name: 'Elsewhere' });
  const outsider = store.createMember({
    teamId: otherTeam.id, username: 'olga', displayName: 'Olga', passwordHash: hashPassword('pw'),
  });

  return { store, dbPath, alice: a.member, bob: b.member, carol: c.member, outsider, tasks: createTaskService(store) };
}

function readFromDisk(dbPath, id) {
  const other = openStore(dbPath);
  try {
    return other.getTask(id);
  } finally {
    other.close();
  }
}

test('the assignee can be set to exactly one team member, and the change is persisted', (t) => {
  const { dbPath, alice, bob, carol, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Assign me', description: 'd' });

  for (const [caller, target] of [[alice, bob], [bob, carol], [carol, alice], [bob, bob]]) {
    const updated = tasks.setAssignee(caller.id, created.id, target.id);
    assert.deepEqual(updated.assignee, { id: target.id, display_name: target.display_name });
    assert.equal(updated.assigneeLabel, target.display_name);
    const row = readFromDisk(dbPath, created.id);
    assert.equal(row.assignee_id, target.id);
    assert.equal(row.title, 'Assign me');
    assert.equal(row.description, 'd');
    assert.equal(row.status, 'To Do');
  }
  assert.equal(tasks.list(alice.id)[0].assigneeLabel, 'Bob');
});

test('the assignee can be cleared to unassigned, and the change is persisted', (t) => {
  const { dbPath, alice, bob, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Clear me' });
  tasks.setAssignee(alice.id, created.id, bob.id);

  const cleared = tasks.setAssignee(bob.id, created.id, null);
  assert.equal(cleared.assignee, null);
  assert.equal(cleared.assigneeLabel, 'unassigned');
  assert.equal(readFromDisk(dbPath, created.id).assignee_id, null);
  assert.equal(tasks.list(alice.id)[0].assigneeLabel, 'unassigned');
});

test("an assignee that is not a member of the task's team is rejected and leaves the task unchanged", (t) => {
  const { store, alice, bob, outsider, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  tasks.setAssignee(alice.id, created.id, bob.id);
  const before = store.getTask(created.id);

  for (const bad of [outsider.id, 999, 0, -1, 1.5, String(bob.id), undefined, '', [bob.id], [bob.id, alice.id], { id: bob.id }]) {
    assert.throws(() => tasks.setAssignee(alice.id, created.id, bad), TaskValidationError, JSON.stringify(bad));
  }
  assert.deepEqual(store.getTask(created.id), before);
});

test('the store refuses non-id assignees and unknown members', (t) => {
  const { store, alice, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  assert.throws(() => store.updateTaskAssignee(created.id, 'bob'), TypeError);
  assert.throws(() => store.updateTaskAssignee(created.id, 999)); // foreign key
  assert.equal(store.updateTaskAssignee(999, null), null);
  assert.equal(store.getTask(created.id).assignee_id, null);
});

test('missing tasks return null and unknown callers are refused', (t) => {
  const { store, alice, bob, outsider, tasks } = setup(t);
  const created = tasks.create(alice.id, { title: 'Keep' });
  for (const id of [999, 0, '1', null]) {
    assert.equal(tasks.setAssignee(alice.id, id, bob.id), null);
  }
  // A member of another team cannot see the task, so it is treated as missing.
  assert.equal(tasks.setAssignee(outsider.id, created.id, outsider.id), null);
  assert.throws(() => tasks.setAssignee(999, created.id, bob.id), UnknownMemberError);
  assert.equal(store.getTask(created.id).assignee_id, null);
});
