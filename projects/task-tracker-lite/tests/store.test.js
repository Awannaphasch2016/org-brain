'use strict';

// ISS-001 acceptance tests (C-006, FR-016, SRS 2.3).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const STORE_MODULE = path.join(__dirname, '..', 'src', 'store.js');
const { openStore, TASK_STATUSES } = require(STORE_MODULE);

function tempDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'store.db');
}

// Runs a script in a separate Node process so each step is a real process start.
function runInFreshProcess(script, dbPath) {
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, STORE_MODULE, DB_PATH: dbPath },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('team, member, and task are read back unchanged after the process restarts', (t) => {
  const dbPath = tempDbPath(t);

  const written = runInFreshProcess(
    `
    const { openStore } = require(process.env.STORE_MODULE);
    const s = openStore(process.env.DB_PATH);
    const team = s.createTeam({ name: 'Core' });
    const member = s.createMember({
      teamId: team.id, username: 'alice', displayName: 'Alice A.',
      passwordHash: 'scrypt$salt$hash',
    });
    const task = s.createTask({ teamId: team.id, title: 'Write spec', description: 'First draft' });
    const bare = s.createTask({ teamId: team.id, title: 'No description' });
    s.close();
    process.stdout.write(JSON.stringify({ team, member, task, bare }));
    `,
    dbPath
  );

  const read = runInFreshProcess(
    `
    const { openStore } = require(process.env.STORE_MODULE);
    const s = openStore(process.env.DB_PATH);
    const out = {
      team: s.getTeam(${written.team.id}),
      member: s.getMember(${written.member.id}),
      task: s.getTask(${written.task.id}),
      bare: s.getTask(${written.bare.id}),
      members: s.listMembers(${written.team.id}),
      tasks: s.listTasks(${written.team.id}),
    };
    s.close();
    process.stdout.write(JSON.stringify(out));
    `,
    dbPath
  );

  assert.deepEqual(read.team, written.team);
  assert.deepEqual(read.member, written.member);
  assert.deepEqual(read.task, written.task);
  assert.deepEqual(read.bare, written.bare);
  assert.deepEqual(read.members, [written.member]);
  assert.deepEqual(read.tasks, [written.task, written.bare]);

  assert.deepEqual(written.member, {
    id: written.member.id,
    team_id: written.team.id,
    username: 'alice',
    display_name: 'Alice A.',
    password_hash: 'scrypt$salt$hash',
  });
  assert.deepEqual(written.task, {
    id: written.task.id,
    team_id: written.team.id,
    title: 'Write spec',
    description: 'First draft',
    status: 'To Do',
    assignee_id: null,
  });
  assert.equal(written.bare.description, '');
});

test('task has exactly the specified fields and nothing else', (t) => {
  const dbPath = tempDbPath(t);
  openStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());

  const cols = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => ({
      name: c.name,
      notnull: c.notnull,
      dflt: c.dflt_value,
    }));

  assert.deepEqual(cols('tasks'), [
    { name: 'id', notnull: 0, dflt: null },
    { name: 'team_id', notnull: 1, dflt: null },
    { name: 'title', notnull: 1, dflt: null },
    { name: 'description', notnull: 1, dflt: "''" },
    { name: 'status', notnull: 1, dflt: "'To Do'" },
    { name: 'assignee_id', notnull: 0, dflt: null },
  ]);
  assert.deepEqual(
    cols('members').map((c) => c.name),
    ['id', 'team_id', 'username', 'display_name', 'password_hash']
  );
});

test('the store exposes no delete operation for tasks', (t) => {
  const store = openStore(tempDbPath(t));
  t.after(() => store.close());
  const ops = Object.keys(store);
  assert.deepEqual(ops.filter((k) => /delete|remove|destroy|drop|purge/i.test(k)), []);
  assert.deepEqual(ops.sort(), [
    'close',
    'createMember',
    'createTask',
    'createTeam',
    'getMember',
    'getMemberByUsername',
    'getTask',
    'getTeam',
    'listMembers',
    'listTasks',
    'listTeams',
  ]);
});

test('username is unique across members', (t) => {
  const store = openStore(tempDbPath(t));
  t.after(() => store.close());
  const team = store.createTeam({ name: 'Core' });
  store.createMember({ teamId: team.id, username: 'bob', displayName: 'Bob', passwordHash: 'h1' });
  assert.throws(() =>
    store.createMember({ teamId: team.id, username: 'bob', displayName: 'Bobby', passwordHash: 'h2' })
  );
  assert.equal(store.listMembers(team.id).length, 1);
  assert.equal(store.getMemberByUsername('bob').display_name, 'Bob');
});

test('task title is required and a rejected task stores nothing', (t) => {
  const store = openStore(tempDbPath(t));
  t.after(() => store.close());
  const team = store.createTeam({ name: 'Core' });
  for (const title of [undefined, '', '   ', 42]) {
    assert.throws(() => store.createTask({ teamId: team.id, title }), /title is required/);
  }
  assert.deepEqual(store.listTasks(team.id), []);
});

test('schema rejects empty titles, unknown statuses, and dangling references', (t) => {
  const dbPath = tempDbPath(t);
  const store = openStore(dbPath);
  const team = store.createTeam({ name: 'Core' });
  store.close();

  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON;');
  const insert = db.prepare(
    'INSERT INTO tasks (team_id, title, status, assignee_id) VALUES (?, ?, ?, ?)'
  );
  assert.throws(() => insert.run(team.id, '  ', 'To Do', null));
  assert.throws(() => insert.run(team.id, 'x', 'Blocked', null));
  assert.throws(() => insert.run(team.id, 'x', 'To Do', 999));
  assert.throws(() => insert.run(999, 'x', 'To Do', null));
  for (const status of TASK_STATUSES) insert.run(team.id, `t ${status}`, status, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 3);
});

test('a member must belong to an existing team', (t) => {
  const store = openStore(tempDbPath(t));
  t.after(() => store.close());
  assert.throws(() =>
    store.createMember({ teamId: 999, username: 'x', displayName: 'X', passwordHash: 'h' })
  );
});
