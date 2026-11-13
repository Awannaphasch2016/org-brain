'use strict';

// Starts the web app for use in a browser:
//   node src/server.js --db <path> [--port 3000] [--host 127.0.0.1] [--secure-cookies]
// This is a local entry point only. Hosting and deployment are outside implementation.

const http = require('node:http');
const { openStore } = require('./store');
const { createWebApp } = require('./web');

function parseArgs(argv) {
  const out = { port: 3000, host: '127.0.0.1', secureCookies: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--secure-cookies') out.secureCookies = true;
    else if (a === '--db' || a === '--port' || a === '--host') {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.db) throw new Error('--db is required');
  out.port = Number(out.port);
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error('--port must be 0-65535');
  return out;
}

function start({ db, port, host, secureCookies }) {
  const store = openStore(db);
  const server = http.createServer(createWebApp({ store, secureCookies }));
  server.on('close', () => store.close());
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

module.exports = { start, parseArgs };

if (require.main === module) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`server: ${err.message}\n`);
    process.exit(2);
  }
  start(args).then((server) => {
    const { address, port } = server.address();
    process.stdout.write(`listening on http://${address}:${port}\n`);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
