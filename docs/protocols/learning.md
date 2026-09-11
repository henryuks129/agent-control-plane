# Recursive Learning Protocol

ACP learns through evidence-backed iterations, not autonomous self-modification.

1. A task produces deterministic evidence and reviewer findings.
2. Findings become lessons and candidate rules.
3. Candidate rules are versioned and remain non-canonical until human approval.
4. Later tasks retrieve approved knowledge through the context router.
5. Repeated findings strengthen candidate confidence; contradictory evidence prevents automatic promotion.
6. Upgrade iterations may improve prompts, routing, budgets, review heuristics and design guidance, but must pass the same review gates as code.

The learning loop must never persist secrets, raw credentials or full model transcripts as project memory.
