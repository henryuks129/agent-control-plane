# Checkpoint Protocol

Checkpoints are compact resumability records, not chat transcripts.

Required fields:
- task_id
- phase
- completed
- current
- changed
- tests
- blockers
- next_action

Target: hundreds of tokens, not thousands. Never store secrets or full prompts.
