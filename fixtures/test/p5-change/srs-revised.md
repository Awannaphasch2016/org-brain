# Introduction

Fixture SRS for an internal task tracker. Not a project baseline.

# Scope

In scope: recording and viewing team tasks. Out of scope: external customer access.

# Functional Requirements

### FR-001

The product shall let a team member create a task with a title and description.

Source: TOR 3.1

### FR-002

The product shall let an authorized user update task status. Allowed status values are open and done.

Source: TOR 3.3

# Nonfunctional Requirements

### NFR-001

The product shall persist task information between sessions.

Source: TOR 3.1

# Acceptance Criteria

### AC-001

A team member can create a task and see it after a new session.

Verifies: FR-001, NFR-001

# Constraints and References

Browser-based internal use. Implementation details wait for later design. External customer access is out of scope.
