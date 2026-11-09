# Terms of Reference

## 1. Document Information

### 1.1 Document Identification

| Field | Value |
| --- | --- |
| Document title | Terms of Reference — Task Tracker Lite |
| Baseline ID | TOR-001 |
| Status | Frozen |
| Project | Task Tracker Lite |

This baseline is immutable. Elaboration belongs in the Software Requirements Specification and the elicitation record. This document is not rewritten after its baseline is approved.

### 1.2 References

This TOR does not adopt an external standard as a compliance obligation. Implementation choices are not references.

## 2. Project Background and Objectives

### 2.1 Background

A small team needs one shared place to record work items and see who is responsible for them. That information is currently scattered across conversations.

### 2.2 Purpose

Provide a lightweight task tracker the team can use to create tasks, find them again, and keep responsibility visible.

### 2.3 Objectives

- A team member can record a task and find it later.
- A task can name a responsible person.
- Finished work can be distinguished from work that is not finished.
- The product stays small enough that implementation choices wait for a later design.

## 3. Project Scope

### 3.1 In Scope

- Creating a task that has a title.
- Viewing the team's tasks.
- Updating a task's title.
- Marking a task done.
- Naming a person responsible for a task.

### 3.2 Out of Scope

- External customer access. People outside the team are not users of this product.
- Billing, payments, and subscriptions.
- Native mobile applications.
- Choosing or delivering the implementation. This TOR states intent only.

### 3.3 High-Level Requirements

These are expectations, not implementation decisions.

| Area | Expectation |
| --- | --- |
| Tasks | The product covers tasks for one team. A task has a title. |
| Responsibility | A task can be associated with a responsible person. |
| Visibility | A team member can see the team's tasks. |
| Completion | Completed work can be distinguished from work that is not completed. |

This TOR does not decide the permission model, the allowed status values, whether one member may edit another member's task, how reassignment works, or what must still be true after the product restarts. Those details are absent and must not be invented.

## 4. Deliverables and Acceptance

### 4.1 Software Deliverables

A task tracker that supports the in-scope expectations. The form of the software is a later design decision.

### 4.2 Documentation Deliverables

- This frozen TOR, baseline TOR-001.
- A Software Requirements Specification elaborated from this TOR and from approved human decisions.

### 4.3 Acceptance Criteria

- A team member can add a task with a title and see that task listed.
- A task can name a responsible person.
- Work that is finished can be told apart from work that is not.
- No capability listed in section 3.2 is present.

Persistence, including what must remain after a restart, is not an acceptance criterion of this TOR.

## 5. Constraints and Commitments

### 5.1 Technical and Organizational Constraints

- Implementation details wait for later design. This TOR does not choose a language, framework, database, or host.
- The product is for the team. It does not serve external customers.

### 5.2 Timeline and Milestones

No dates are committed in this baseline.

### 5.3 Responsibilities and Dependencies

A person approves any requirement this TOR leaves open. The TOR itself stays unchanged.

## 6. References

None beyond this baseline.
