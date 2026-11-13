'use strict';

// ISS-005: Task service. Create, list, and view tasks (C-003).
// FR-001, FR-002, FR-005, FR-008, FR-009, FR-012.
// ISS-006: Edit title and description (FR-007, FR-012).
// ISS-007: Change status (FR-003, FR-004, FR-012).
// ISS-008: Set or clear the assignee (FR-005, FR-006, FR-012, FR-014).
// The caller is identified by the session's member id. Any member may perform every
// operation on any task in their team. There are no roles and no per-task checks.

const { TASK_STATUSES } = require('./store');
const { createDirectory } = require('./directory');

class TaskValidationError extends Error {}
class UnknownMemberError extends Error {}

function createTaskService(store) {
  const directory = createDirectory(store);

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

    // Sets a task's status to one of 'To Do', 'In Progress', or 'Done'. Returns the
    // updated task in the view form, or null when the task is not in the caller's team.
    // Any other value is rejected and leaves the task unchanged.
    setStatus(memberId, taskId, status) {
      const current = view(memberId, taskId);
      if (current === null) return null;
      if (!TASK_STATUSES.includes(status)) {
        throw new TaskValidationError(`status must be one of: ${TASK_STATUSES.join(', ')}`);
      }
      store.updateTaskStatus(taskId, status);
      return view(memberId, taskId);
    },

    // Sets the task's single assignee to a member of the caller's team (which is the
    // task's team), or clears it when assigneeId is null. Returns the updated task in
    // the view form, or null when the task is not in the caller's team. Any id that is
    // not a member of that team is rejected and leaves the task unchanged.
    setAssignee(memberId, taskId, assigneeId) {
      const current = view(memberId, taskId);
      if (current === null) return null;
      if (assigneeId !== null) {
        const team = directory.forMember(memberId);
        const assignable = Number.isInteger(assigneeId) && team.members.some((m) => m.id === assigneeId);
        if (!assignable) {
          throw new TaskValidationError('assignee must be a member of the team, or null for unassigned');
        }
      }
      store.updateTaskAssignee(taskId, assigneeId);
      return view(memberId, taskId);
    },
  });
}

module.exports = { createTaskService, TaskValidationError, UnknownMemberError };
