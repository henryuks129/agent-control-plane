---
paths: [src/memory/**, tests/memory.test.ts]
keywords: [memory, rule, guard]
check: npm test
---
Memory code must stay free of model calls and network access: matching is by
path and keyword so the same input always gives the same result.

A rule is kept whole or left out, never cut. ACP writes only inside its own
marked block in AGENTS.md and never overwrites a block edited by hand.
Anything written out is scanned for secrets first.
