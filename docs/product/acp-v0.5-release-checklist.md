# ACP v0.5 Release Checklist

Run this checklist from the registered local ACP project before declaring v0.5 complete.

## Automated checks

- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] `git diff --check` reports no whitespace errors.
- [ ] `acp /task graph TASK-0002` matches `acp /task progress TASK-0002`.

## Local dashboard smoke check

- [ ] Run `acp /ui` and open `http://127.0.0.1:4317`.
- [ ] Select a completed task and verify graph nodes, dependencies, and statuses are readable.
- [ ] Verify the task summary uses cards rather than raw JSON.
- [ ] Verify artifacts, findings, learning, and upgrades are shown as task-scoped history sections.
- [ ] Open one text artifact preview and confirm it stays within the local artifact store.
- [ ] Verify `Validate`, `Approve`, and `Apply` remain available for a task with a patch artifact.
- [ ] Do not validate, approve, or apply the historical TASK-0002 patch during this smoke check.
- [ ] Confirm the browser renders UTF-8 separators and graph arrows normally.

## Safety boundary

- [ ] No task view starts a task or applies a patch automatically.
- [ ] Patch application remains impossible until validation and explicit human approval succeed.
- [ ] Project settings and persisted dashboard data contain no API keys or other credentials.
- [ ] No remote Git operation, repository upload, cloning, or push is performed.
