# TOR contract fields

Approved intake metadata. `validate_intake` reads this file and reports each missing name. It does not change the approved TOR structure guideline.

## Required

- name: project id | label: Project id
- name: project name | label: Project name
- name: customer contact | label: Customer contact
- name: owner | label: Owner
- name: stakeholders | label: Stakeholders | min: 1
- name: purpose | label: Purpose
- name: TOR scope summary | label: TOR scope summary

## Optional

- name: target dates | label: Target dates
