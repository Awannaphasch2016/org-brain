'use strict';

// ISS-009: Web UI. Sign-in and sign-out pages (C-001, FR-010, FR-011, FR-013, FR-017,
// NFR-002). It builds on the ISS-004 session gate in app.js. There is no registration
// page or link: accounts are created only with the add-member command.
// ISS-010: The task list (at / and /tasks), task detail, and create-task pages come from
// task-pages.js.

const { createApp } = require('./app');
const { createDirectory } = require('./directory');
const { page, sendHtml } = require('./html');
const { createTaskPages } = require('./task-pages');

function loginPage(req, res, { failed }) {
  const error = failed ? '<p class="error" role="alert">Incorrect username or password.</p>\n' : '';
  const body = `<h1>Sign in</h1>
${error}<form method="post" action="/login">
  <label for="username">Username</label>
  <input id="username" name="username" autocomplete="username" required autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <p><button type="submit">Sign in</button></p>
</form>`;
  sendHtml(res, failed ? 401 : 200, page({ title: 'Sign in', body }));
}

function createWebApp({ store, secureCookies = false, routes = {} } = {}) {
  const directory = createDirectory(store);

  // Display name for the header of signed-in pages.
  function whoIs(session) {
    const me = directory.forMember(session.memberId);
    return me.members.find((m) => m.id === session.memberId).display_name;
  }

  return createApp({
    store,
    secureCookies,
    loginPage,
    routes: { ...createTaskPages({ store, whoIs }), ...routes },
  });
}

module.exports = { createWebApp, loginPage };
