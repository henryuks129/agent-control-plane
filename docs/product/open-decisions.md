# Open decisions and placeholders

Things not decided yet. The website and app designs show each one as a
`[placeholder]`. Update this file when one is decided, then replace the
placeholder everywhere it appears.

## Before public launch

| Item | Placeholder | Where it appears | Notes |
|---|---|---|---|
| Domain | `[domain]` | Download page, install script URLs, previews (`pr-12.preview.<domain>`) | Check `.dev`, `.app`, `.so` |
| npm package name | `[package]` | Download page (`npm install -g`) | `acp` is likely taken; check npm |
| Version number | `[version]` | Download file names, report form | Current `package.json` says 0.3.1 |
| Security email | `[security email]` | Security page, `SECURITY.md` | GitHub private vulnerability reporting also works |
| Response time | `[response time]` | Security page, Report a problem page | For example "2 working days" |
| Issue number | `#[number]` | Report confirmation screen | Filled in by the real form |
| Homebrew cask name | `brew install --cask acp` | Home, Download, Docs | A suggestion until we register it |
| winget id | `winget install ACP` | Home, Download | A suggestion until we register it |
| License | none yet | Repository, website footer | MIT suggested (ADR-0007 item 17) |
| GitHub repository | none yet | Every "GitHub" link | Public or private (ADR-0008 step 3) |
| Apple Developer Program | not enrolled | macOS signing | US$99 a year; needed for signed downloads |

## Product questions

| Question | Status |
|---|---|
| Plain chat (no code changes) as well as coding agents? | Decided: one thread type, no mode switch. Questions get answers, requests become tasks. See ADR-0008 §9b |
| Memory scope | Decided: per project, in layers (user, project, path rules, task); narrower wins. See ADR-0008 §9g |
| Write memory to `AGENTS.md`/`CLAUDE.md` | Open: engineering decisions listed in ADR-0008 §9g |
| Import memory from each harness | Proposed: ADR-0008 §9h |
| Optional ACP account (Clerk) | Only when remote access or the phone app is built (ADR-0008 §9a) |
| Product name | Keep "ACP — Agent Control Plane" (docs/product/naming.md) |
