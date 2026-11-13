'use strict';

// ISS-010: Web UI. Task list, task detail, and create-task pages (C-001, FR-001, FR-002,
// FR-008, FR-009, FR-017, NFR-002). The pages are plain HTML over the ISS-005 task
// service, and every route sits behind the ISS-004 session gate.

const { createTaskService, TaskValidationError } = require('./tasks');
const { escapeHtml, page, sendHtml } = require('./html');

function statusAndAssignee(task) {
  return { status: escapeHtml(task.status), assignee: escapeHtml(task.assigneeLabel) };
}

function listBody(tasks) {
  const rows = tasks.map((t) => {
    const { status, assignee } = statusAndAssignee(t);
    return `  <tr><td><a href="/tasks/${t.id}">${escapeHtml(t.title)}</a></td><td>${status}</td><td>${assignee}</td></tr>`;
  });
  const table = tasks.length === 0
    ? '<p id="no-tasks">No tasks yet.</p>'
    : `<table id="task-list">
<thead><tr><th>Title</th><th>Status</th><th>Assignee</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>`;
  return `<h1>Tasks</h1>
<p><a href="/tasks/new" id="new-task">New task</a></p>
${table}`;
}

function newTaskBody({ title = '', description = '', error = null } = {}) {
  const err = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>\n` : '';
  return `<h1>New task</h1>
${err}<form method="post" action="/tasks">
  <label for="title">Title</label>
  <input id="title" name="title" value="${escapeHtml(title)}" required>
  <label for="description">Description</label>
  <textarea id="description" name="description" rows="6">${escapeHtml(description)}</textarea>
  <p><button type="submit">Create task</button> <a href="/">Cancel</a></p>
</form>`;
}

function detailBody(task) {
  const { status, assignee } = statusAndAssignee(task);
  const description = task.description === ''
    ? '<p id="task-description"><em>No description</em></p>'
    : `<p id="task-description" style="white-space: pre-wrap">${escapeHtml(task.description)}</p>`;
  return `<p><a href="/">&larr; All tasks</a></p>
<h1 id="task-title">${escapeHtml(task.title)}</h1>
<dl>
  <dt>Status</dt><dd id="task-status">${status}</dd>
  <dt>Assignee</dt><dd id="task-assignee">${assignee}</dd>
</dl>
<h2>Description</h2>
${description}`;
}

function createTaskPages({ store, whoIs }) {
  const tasks = createTaskService(store);
  const render = (res, status, title, session, body) =>
    sendHtml(res, status, page({ title, body, signedInAs: whoIs(session) }));

  const list = (req, res, { session }) =>
    render(res, 200, 'Tasks', session, listBody(tasks.list(session.memberId)));

  return Object.freeze({
    'GET /': list,
    'GET /tasks': list,

    'GET /tasks/new': (req, res, { session }) =>
      render(res, 200, 'New task', session, newTaskBody()),

    'POST /tasks': async (req, res, { session, form }) => {
      const data = await form();
      const title = data.get('title') ?? '';
      const description = data.get('description') ?? '';
      try {
        tasks.create(session.memberId, { title, description });
      } catch (err) {
        if (!(err instanceof TaskValidationError)) throw err;
        return render(res, 400, 'New task', session, newTaskBody({ title, description, error: 'Title is required.' }));
      }
      res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    },

    'GET /tasks/:id': (req, res, { session, params }) => {
      const task = tasks.view(session.memberId, params.id);
      if (task === null) return render(res, 404, 'Not found', session, '<h1>Task not found</h1>\n<p><a href="/">All tasks</a></p>');
      return render(res, 200, task.title, session, detailBody(task));
    },
  });
}

module.exports = { createTaskPages };
