# Task Protocol

A task is the unit of work and context boundary.

Required:
- id
- title
- type
- objective
- scope.allowed
- acceptance
- review.required

Optional:
- dependencies
- design.required
- architecture.required
- priority
- model_preferences

Agents must not expand scope without recording a reason and requesting orchestration approval.
