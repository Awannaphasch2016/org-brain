'use strict';

// ISS-005: Task service. Create, list, and view tasks (C-003).
// FR-001, FR-002, FR-005, FR-008, FR-009, FR-012.
// ISS-006: Edit title and description (FR-007, FR-012).
// The caller is identified by the session's member id. Any member may perform every
// operation on any task in their team. There are no roles and no per-task checks.

class TaskValidationError extends Error {}
class UnknownMemberError extends Error {}

function createTaskService(store) {
  function teamOf(memberId) {
    const member = Number.isInteger(memberId) ? store.getMember(memberId) : null;
    if (member === null) throw new UnknownMemberError('unknown member');
    return member.team_id;
  }

  function assigneeOf(task) {
    if (task.assignee_id === null) return null;
    const m = store.getMember(task.assignee_id);
    return m === null ? null : Object.freeze({ id: m.id, display_name: m.display_name });
  }

  function summary(task) {
    const assignee = assigneeOf(task);
    return Object.freeze({
      id: task.id,
      title: task.title,
      status: task.status,
      assignee,
      assigneeLabel: assignee ? assignee.display_name : 'unassigned',
    });
  }

  // One task's title, description, status, and assignee, or null when the task is
  // not in the caller's team.
  function view(memberId, taskId) {
    const teamId = teamOf(memberId);
    const task = Number.isInteger(taskId) ? store.getTask(taskId) : null;
    if (task === null || task.team_id !== teamId) return null;
    return Object.freeze({ ...summary(task), description: task.description });
  }

  return Object.freeze({
    // Creates a task in the caller's team with status 'To Do' and no assignee.
    create(memberId, { title, description = '' } = {}) {
      const teamId = teamOf(memberId);
      if (typeof title !== 'string' || title.trim() === '') {
        throw new TaskValidationError('title is required');
      }
      if (typeof description !== 'string') {
        throw new TaskValidationError('description must be text');
      }
      const task = store.createTask({ teamId, title, description });
      return view(memberId, task.id);
    },

    // Every task in the caller's team, with title, status, and assignee or 'unassigned'.
    list(memberId) {
      return Object.freeze(store.listTasks(teamOf(memberId)).map(summary));
    },

    view,

    // Changes an existing task's title and description. If description is omitted, the
    // current description is kept. Returns the updated task in the view form, or null
    // when the task is not in the caller's team. An empty title is rejected and leaves
    // the task unchanged.
    edit(memberId, taskId, { title, description } = {}) {
      const current = view(memberId, taskId);
      if (current === null) return null;
      if (typeof title !== 'string' || title.trim() === '') {
        throw new TaskValidationError('title is required');
      }
      if (description !== undefined && typeof description !== 'string') {
        throw new TaskValidationError('description must be text');
      }
      store.updateTaskText(taskId, {
        title,
        description: description === undefined ? current.description : description,
      });
      return view(memberId, taskId);
    },
  });
}

module.exports = { createTaskService, TaskValidationError, UnknownMemberError };
