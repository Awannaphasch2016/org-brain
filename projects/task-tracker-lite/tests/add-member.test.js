'use strict';

// ISS-002 acceptance tests (C-005, FR-013, FR-015, A-002).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const CLI = path.join(SRC, 'add-member.js');
const { openStore } = require(path.join(SRC, 'store.js'));
const { verifyPassword, hashPassword } = require(path.join(SRC, 'password.js'));

function tempDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-add-member-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'store.db');
}

function addMemberCli(dbPath, args, password) {
  return spawnSync(process.execPath, [CLI, '--db', dbPath, ...args], {
    input: password === undefined ? '' : `${password}\n`,
    encoding: 'utf8',
  });
}

function snapshot(dbPath) {
  const s = openStore(dbPath);
  try {
    const teams = s.listTeams();
    return {
      teams,
      members: teams.flatMap((tm) => s.listMembers(tm.id)),
      tasks: teams.flatMap((tm) => s.listTasks(tm.id)),
    };
  } finally {
    s.close();
  }
}

test('first run on an empty store creates exactly one team and one member with a salted hash', (t) => {
  const db = tempDbPath(t);
  const r = addMemberCli(db, ['--username', 'alice', '--display-name', 'Alice A.', '--team-name', 'Core'], 's3cret pass');
  assert.equal(r.status, 0, r.stderr);

  const { teams, members } = snapshot(db);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].name, 'Core');
  assert.equal(members.length, 1);
  const [alice] = members;
  assert.equal(alice.team_id, teams[0].id);
  assert.equal(alice.username, 'alice');
  assert.equal(alice.display_name, 'Alice A.');
  assert.ok(!alice.password_hash.includes('s3cret'), 'plain password must not be stored');
  assert.match(alice.password_hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(verifyPassword('s3cret pass', alice.password_hash), true);
  assert.equal(verifyPassword('wrong', alice.password_hash), false);

  const raw = fs.readFileSync(db);
  assert.equal(raw.includes(Buffer.from('s3cret pass')), false, 'plain password must not appear in the store file');
});

test('second run adds a member to the same team and leaves every task unchanged', (t) => {
  const db = tempDbPath(t);
  assert.equal(addMemberCli(db, ['--username', 'alice', '--display-name', 'Alice', '--team-name', 'Core'], 'pw-a').status, 0);

  const s = openStore(db);
  const team = s.listTeams()[0];
  s.createTask({ teamId: team.id, title: 'Existing task', description: 'keep me' });
  s.createTask({ teamId: team.id, title: 'Another' });
  s.close();
  const before = snapshot(db);

  const r = addMemberCli(db, ['--username', 'bob', '--display-name', 'Bob'], 'pw-a');
  assert.equal(r.status, 0, r.stderr);

  const after = snapshot(db);
  assert.deepEqual(after.teams, before.teams);
  assert.deepEqual(after.tasks, before.tasks);
  assert.equal(after.members.length, 2);
  const bob = after.members.find((m) => m.username === 'bob');
  assert.equal(bob.team_id, team.id);
  assert.notEqual(bob.password_hash, after.members[0].password_hash, 'same password must hash differently (salted)');
});

test('rejected runs change nothing', async (t) => {
  const db = tempDbPath(t);

  const noTeam = addMemberCli(db, ['--username', 'alice', '--display-name', 'Alice'], 'pw');
  assert.equal(noTeam.status, 2);
  assert.match(noTeam.stderr, /--team-name is required/);
  assert.deepEqual(snapshot(db), { teams: [], members: [], tasks: [] });

  const noPassword = addMemberCli(db, ['--username', 'alice', '--display-name', 'Alice', '--team-name', 'Core'], '');
  assert.equal(noPassword.status, 2);
  assert.deepEqual(snapshot(db), { teams: [], members: [], tasks: [] });

  assert.equal(addMemberCli(db, ['--username', 'alice', '--display-name', 'Alice', '--team-name', 'Core'], 'pw').status, 0);
  const baseline = snapshot(db);

  await t.test('duplicate username', () => {
    const r = addMemberCli(db, ['--username', 'alice', '--display-name', 'Other'], 'pw2');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
    assert.deepEqual(snapshot(db), baseline);
  });

  await t.test('second team is refused', () => {
    const r = addMemberCli(db, ['--username', 'carol', '--display-name', 'Carol', '--team-name', 'Other'], 'pw');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /only one team/);
    assert.deepEqual(snapshot(db), baseline);
  });

  await t.test('password flag is not accepted', () => {
    const r = addMemberCli(db, ['--username', 'dave', '--display-name', 'Dave', '--password', 'pw'], 'pw');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown argument: --password/);
    assert.deepEqual(snapshot(db), baseline);
  });
});

test('hashPassword salts each hash', () => {
  const a = hashPassword('same');
  const b = hashPassword('same');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('same', a) && verifyPassword('same', b));
  assert.throws(() => hashPassword(''), /password is required/);
});

test('no module other than the add-member command creates members', () => {
  // Guards FR-013: no web route may create a member. Only the CLI calls createMember.
  const callers = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith('.js') && f !== 'store.js')
    .filter((f) => /createMember\s*\(|require\(['"]\.\/add-member['"]\)/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
  assert.deepEqual(callers, ['add-member.js']);
  const cli = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(cli, /require\(['"]node:(http|https|http2|net)['"]\)/);
});
