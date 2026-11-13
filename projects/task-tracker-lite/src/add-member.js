'use strict';

// ISS-002: Operator `add-member` command for account provisioning (C-005).
// Usage:
//   node src/add-member.js --db <path> --username <name> --display-name <name> [--team-name <name>]
// The password is read from stdin: a hidden prompt on a terminal, or the first line when piped.
// The first run on an empty store creates the single Team and needs --team-name.
// Later runs add the member to that same Team. This module is command-line only.
// No web route may call it (FR-013).

const { openStore } = require('./store');
const { hashPassword } = require('./password');

class UsageError extends Error {}

function requireText(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UsageError(`${flag} is required`);
  }
  if (value !== value.trim()) {
    throw new UsageError(`${flag} must not start or end with whitespace`);
  }
}

// Adds one member to the store's single team, creating that team on an empty store.
// Every input is checked before anything is written, so a rejected call stores nothing.
function addMember(store, { username, displayName, password, teamName }) {
  requireText(username, '--username');
  requireText(displayName, '--display-name');
  if (typeof password !== 'string' || password.length === 0) {
    throw new UsageError('password is required');
  }

  const teams = store.listTeams();
  if (teams.length > 1) {
    throw new UsageError('store holds more than one team; refusing to continue');
  }
  let team = teams[0] || null;
  if (team === null) {
    if (teamName === undefined) {
      throw new UsageError('--team-name is required when the store has no team yet');
    }
    requireText(teamName, '--team-name');
  } else if (teamName !== undefined && teamName !== team.name) {
    throw new UsageError(`store already has team "${team.name}"; only one team is allowed`);
  }
  if (store.getMemberByUsername(username) !== null) {
    throw new UsageError(`username "${username}" already exists`);
  }

  const passwordHash = hashPassword(password);
  if (team === null) team = store.createTeam({ name: teamName });
  const member = store.createMember({ teamId: team.id, username, displayName, passwordHash });
  return { team, member };
}

function parseArgs(argv) {
  const map = { '--db': 'db', '--username': 'username', '--display-name': 'displayName', '--team-name': 'teamName' };
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = map[argv[i]];
    if (!key) throw new UsageError(`unknown argument: ${argv[i]}`);
    if (i + 1 >= argv.length) throw new UsageError(`${argv[i]} needs a value`);
    if (key in out) throw new UsageError(`${argv[i]} given twice`);
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

function readPasswordFromPipe(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolve(data.split(/\r?\n/)[0]));
    stream.on('error', reject);
  });
}

function readPasswordFromTty(input, output) {
  const readline = require('node:readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    output.write('Password: ');
    rl._writeToOutput = () => {}; // do not echo typed characters
    rl.question('', (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}

async function main(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  let store;
  try {
    const args = parseArgs(argv);
    requireText(args.db, '--db');
    requireText(args.username, '--username');
    requireText(args.displayName, '--display-name');
    const password = io.stdin.isTTY
      ? await readPasswordFromTty(io.stdin, io.stderr)
      : await readPasswordFromPipe(io.stdin);
    store = openStore(args.db);
    const { team, member } = addMember(store, { ...args, password });
    io.stdout.write(`added member ${member.username} (id ${member.id}) to team ${team.name} (id ${team.id})\n`);
    return 0;
  } catch (err) {
    io.stderr.write(`add-member: ${err.message}\n`);
    return err instanceof UsageError ? 2 : 1;
  } finally {
    if (store) store.close();
  }
}

module.exports = { addMember, main, UsageError };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
