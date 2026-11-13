'use strict';

// ISS-001: Persistent store with Team, Member, and Task schema (C-006).
// Backed by Node's built-in SQLite module (decision by approver, 2026-11 Slack thread).
// The store deliberately offers no delete operation for tasks (FR-016).

const { DatabaseSync } = require('node:sqlite');

const TASK_STATUSES = Object.freeze(['To Do', 'In Progress', 'Done']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'To Do'
                      CHECK (status IN ('To Do', 'In Progress', 'Done')),
  assignee_id INTEGER NULL REFERENCES members(id)
);
`;

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} is required`);
  }
}

function plain(row) {
  return row === undefined ? null : { ...row };
}

function openStore(filePath) {
  requireNonEmptyString(filePath, 'filePath');
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const stmt = {
    insertTeam: db.prepare('INSERT INTO teams (name) VALUES (?)'),
    getTeam: db.prepare('SELECT id, name FROM teams WHERE id = ?'),
    listTeams: db.prepare('SELECT id, name FROM teams ORDER BY id'),
    insertMember: db.prepare(
      'INSERT INTO members (team_id, username, display_name, password_hash) VALUES (?, ?, ?, ?)'
    ),
    getMember: db.prepare(
      'SELECT id, team_id, username, display_name, password_hash FROM members WHERE id = ?'
    ),
    getMemberByUsername: db.prepare(
      'SELECT id, team_id, username, display_name, password_hash FROM members WHERE username = ?'
    ),
    listMembers: db.prepare(
      'SELECT id, team_id, username, display_name, password_hash FROM members WHERE team_id = ? ORDER BY id'
    ),
    insertTask: db.prepare(
      'INSERT INTO tasks (team_id, title, description) VALUES (?, ?, ?)'
    ),
    getTask: db.prepare(
      'SELECT id, team_id, title, description, status, assignee_id FROM tasks WHERE id = ?'
    ),
    listTasks: db.prepare(
      'SELECT id, team_id, title, description, status, assignee_id FROM tasks WHERE team_id = ? ORDER BY id'
    ),
  };

  return Object.freeze({
    createTeam({ name }) {
      requireNonEmptyString(name, 'name');
      const { lastInsertRowid } = stmt.insertTeam.run(name);
      return plain(stmt.getTeam.get(lastInsertRowid));
    },
    getTeam(id) {
      return plain(stmt.getTeam.get(id));
    },
    listTeams() {
      return stmt.listTeams.all().map(plain);
    },

    createMember({ teamId, username, displayName, passwordHash }) {
      requireNonEmptyString(username, 'username');
      requireNonEmptyString(displayName, 'display_name');
      requireNonEmptyString(passwordHash, 'password_hash');
      const { lastInsertRowid } = stmt.insertMember.run(
        teamId,
        username,
        displayName,
        passwordHash
      );
      return plain(stmt.getMember.get(lastInsertRowid));
    },
    getMember(id) {
      return plain(stmt.getMember.get(id));
    },
    getMemberByUsername(username) {
      return plain(stmt.getMemberByUsername.get(username));
    },
    listMembers(teamId) {
      return stmt.listMembers.all(teamId).map(plain);
    },

    // New tasks always start with status 'To Do' and no assignee (schema defaults).
    createTask({ teamId, title, description = '' }) {
      requireNonEmptyString(title, 'title');
      if (typeof description !== 'string') {
        throw new TypeError('description must be a string');
      }
      const { lastInsertRowid } = stmt.insertTask.run(teamId, title, description);
      return plain(stmt.getTask.get(lastInsertRowid));
    },
    getTask(id) {
      return plain(stmt.getTask.get(id));
    },
    listTasks(teamId) {
      return stmt.listTasks.all(teamId).map(plain);
    },

    close() {
      db.close();
    },
  });
}

module.exports = { openStore, TASK_STATUSES };
