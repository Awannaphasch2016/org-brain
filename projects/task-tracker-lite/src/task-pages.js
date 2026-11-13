'use strict';

// ISS-010: Web UI. Task list, task detail, and create-task pages (C-001, FR-001, FR-002,
// FR-008, FR-009, FR-017, NFR-002). The pages are plain HTML over the ISS-005 task
// service, and every route sits behind the ISS-004 session gate.
// ISS-011: Edit, status, and assignee controls on the task detail page (FR-003, FR-005,
// FR-006, FR-007, FR-017, NFR-002).

const { createTaskService, TaskValidationError } = require('./tasks');
const { createDirectory } = require('./directory');
const { TASK_STATUSES } = require('./store');
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

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

// The controls under the read-only details. Each one is its own form that posts back
// and then redirects to the detail page, so a reload shows the stored values.
function controlsBody(task, members, { title = task.title, description = task.description } = {}) {
  const statusOptions = TASK_STATUSES.map((s) => `    ${option(s, s, s === task.status)}`).join('\n');
  const assigneeOptions = [
    `    ${option('', 'unassigned', task.assignee === null)}`,
    ...members.map((m) => `    ${option(String(m.id), m.display_name, task.assignee !== null && task.assignee.id === m.id)}`),
  ].join('\n');
  return `<h2>Edit</h2>
<form method="post" action="/tasks/${task.id}/edit" id="edit-form">
  <label for="edit-title">Title</label>
  <input id="edit-title" name="title" value="${escapeHtml(title)}" required>
  <label for="edit-description">Description</label>
  <textarea id="edit-description" name="description" rows="6">${escapeHtml(description)}</textarea>
  <p><button type="submit">Save</button></p>
</form>
<form method="post" action="/tasks/${task.id}/status" id="status-form">
  <label for="status">Status</label>
  <select id="status" name="status">
${statusOptions}
  </select>
  <button type="submit">Update status</button>
</form>
<form method="post" action="/tasks/${task.id}/assignee" id="assignee-form">
  <label for="assignee">Assignee</label>
  <select id="assignee" name="assignee">
${assigneeOptions}
  </select>
  <button type="submit">Update assignee</button>
</form>`;
}

function detailBody(task, members, { error = null, edit } = {}) {
  const { status, assignee } = statusAndAssignee(task);
  const err = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>\n` : '';
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
${description}
${err}${controlsBody(task, members, edit)}`;
}

function createTaskPages({ store, whoIs }) {
  const tasks = createTaskService(store);
  const directory = createDirectory(store);
  const membersFor = (session) => directory.forMember(session.memberId).members;
  const render = (res, status, title, session, body) =>
    sendHtml(res, status, page({ title, body, signedInAs: whoIs(session) }));

  const notFound = (res, session) =>
    render(res, 404, 'Not found', session, '<h1>Task not found</h1>\n<p><a href="/">All tasks</a></p>');

  // Runs one change. On success it redirects (303) to the detail page. A rejected value
  // shows the detail page again with an error and status 400. The service has already
  // left the task unchanged.
  function change(res, session, taskId, apply, message, edit) {
    let updated;
    try {
      updated = apply();
    } catch (err) {
      if (!(err instanceof TaskValidationError)) throw err;
      const task = tasks.view(session.memberId, taskId);
      if (task === null) return notFound(res, session);
      return render(res, 400, task.title, session, detailBody(task, membersFor(session), { error: message, edit }));
    }
    if (updated === null) return notFound(res, session);
    res.writeHead(303, { Location: `/tasks/${taskId}`, 'Cache-Control': 'no-store' });
    return res.end();
  }

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
      if (task === null) return notFound(res, session);
      return render(res, 200, task.title, session, detailBody(task, membersFor(session)));
    },

    'POST /tasks/:id/edit': async (req, res, { session, params, form }) => {
      const data = await form();
      const title = data.get('title') ?? '';
      const description = data.get('description') ?? '';
      return change(res, session, params.id, () => tasks.edit(session.memberId, params.id, { title, description }),
        'Title is required.', { title, description });
    },

    'POST /tasks/:id/status': async (req, res, { session, params, form }) => {
      const status = (await form()).get('status');
      return change(res, session, params.id, () => tasks.setStatus(session.memberId, params.id, status),
        `Status must be one of: ${TASK_STATUSES.join(', ')}.`);
    },

    'POST /tasks/:id/assignee': async (req, res, { session, params, form }) => {
      const raw = (await form()).get('assignee');
      // '' means unassigned. A missing field is not treated as unassigned: it stays
      // undefined, and the service rejects it.
      let assigneeId = raw === null ? undefined : raw;
      if (raw === '') assigneeId = null;
      else if (typeof raw === 'string' && /^[1-9][0-9]{0,15}$/.test(raw)) assigneeId = Number(raw);
      return change(res, session, params.id, () => tasks.setAssignee(session.memberId, params.id, assigneeId),
        'Assignee must be unassigned or a member of the team.');
    },
  });
}

module.exports = { createTaskPages };
