# ACP Recursive Upgrade Loop

ACP upgrades itself through bounded iterations. An iteration is a product/engineering change evaluated against evidence; it is not unrestricted self-modification.

```text
Run → Evidence → Findings → Lessons → Candidate Rule
  ↑                                      │
  └──────────── Approved knowledge ──────┘
```

## Iteration gates

1. Capture task outcome, token/request usage, failures and review findings.
2. Cluster repeated findings.
3. Generate candidate improvements to prompts, routing, budgets, context rules, review heuristics or design guidance.
4. Keep candidates non-canonical until a human approves them.
5. Apply one bounded upgrade at a time.
6. Run deterministic and reviewer gates.
7. Compare against the previous iteration.
8. Promote only improvements with evidence of benefit and no unacceptable regressions.

The loop must not rewrite its own safety boundaries, secret-handling policy or approval rules without an explicit human-controlled product change.

## Upgrade state machine

```text
candidate → approved → applied → validated
     │          │          │
     ├──────────┴──────────┴──→ rejected
     └─────────────────────────→ rolled_back
```

Every iteration stores its parent, hypothesis, proposed change, evidence and lifecycle status. A later iteration can reference a validated parent, allowing ACP to measure a chain of improvements rather than treating every run as isolated.
