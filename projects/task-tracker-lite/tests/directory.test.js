'use strict';

// ISS-003 acceptance tests (C-004, FR-014, FR-005).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const { openStore } = require(path.join(SRC, 'store.js'));
const { addMember } = require(path.join(SRC, 'add-member.js'));
const { createDirectory } = require(path.join(SRC, 'directory.js'));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-directory-'));
  const store = openStore(path.join(dir, 'store.db'));
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = addMember(store, { username: 'alice', displayName: 'Alice', password: 'pw', teamName: 'Core' });
  const b = addMember(store, { username: 'bob', displayName: 'Bob', password: 'pw' });
  const c = addMember(store, { username: 'carol', displayName: 'Carol', password: 'pw' });
  return { store, team: a.team, alice: a.member, bob: b.member, carol: c.member };
}

test("returns the signed-in member's team and every member of that team", (t) => {
  const { store, team, alice, bob, carol } = setup(t);
  const directory = createDirectory(store);

  const expected = {
    team: { id: team.id, name: 'Core' },
    members: [alice, bob, carol].map((m) => ({ id: m.id, username: m.username, display_name: m.display_name })),
  };
  for (const me of [alice, bob, carol]) {
    assert.deepEqual(directory.forMember(me.id), expected);
  }
});

test('never exposes password hashes', (t) => {
  const { store, alice } = setup(t);
  const result = createDirectory(store).forMember(alice.id);
  for (const m of result.members) {
    assert.deepEqual(Object.keys(m).sort(), ['display_name', 'id', 'username']);
  }
  assert.doesNotMatch(JSON.stringify(result), /scrypt|password/);
});

test('unknown or invalid member ids return null', (t) => {
  const { store } = setup(t);
  const directory = createDirectory(store);
  for (const id of [999, 0, -1, '1', null, undefined, 1.5]) {
    assert.equal(directory.forMember(id), null);
  }
});

test('the directory exposes no write operation', (t) => {
  const { store, alice } = setup(t);
  const directory = createDirectory(store);
  assert.deepEqual(Object.keys(directory), ['forMember']);
  assert.ok(Object.isFrozen(directory));

  const result = directory.forMember(alice.id);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.team) && Object.isFrozen(result.members));
  assert.throws(() => result.members.push({ id: 42 }), TypeError);

  const source = fs.readFileSync(path.join(SRC, 'directory.js'), 'utf8');
  assert.doesNotMatch(source, /\.create\w*\(|INSERT|UPDATE|DELETE/);
});
