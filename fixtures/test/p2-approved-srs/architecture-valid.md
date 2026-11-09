# Introduction

Fixture architecture for the approved fixture SRS. Not a project baseline.

SRS baseline: 1272e5f41a02f5cf041be44e5c3d5d38721d98fe9a8189d89273f726b235105a

# Constraints

Internal browser use only. External customer access stays out of scope. No payment processing.

# Components

### C-001

Records a task with a title and description.

Source: FR-001

### C-002

Stores task records so they remain available in a later session.

Source: NFR-001

# Interfaces

A person uses a browser. No external customer interface is in scope.

# Data

A task has a title, a description, and a status. The allowed status values stay an open decision.

# Decisions and deferrals

The storage mechanism is deferred. It is not chosen here.

# Traceability

C-001 traces to FR-001. C-002 traces to NFR-001.
