---
name: voice-commits
description: Prepare, split, review, or amend Git commits in the Voice repository. Use when creating commits or choosing commit boundaries and messages.
---

# Voice commit guide

Use `<type>: <imperative description>`. Do not include scopes: write `feat: ...`, never `feat(audio): ...`.
Allowed types:

- `feat`: new user-facing functionality.
- `fix`: corrected behavior or a regression.
- `refactor`: restructuring or redesign while preserving functionality.
- `chore`: maintenance, repository guidance, or tooling housekeeping.
- `infra`: deployment, hosting, container, or infrastructure changes.

Examples: `feat: add microphone playback testing`, `fix: restore logout access`, `refactor: unify call and lobby layouts`.

Split changes by functionality, not by file or by the conversation turn. Keep each commit coherent and reviewable, with its required translations, styles, and relevant tests. Stage shared files selectively when they contain multiple features. Order dependent commits so each has the code it needs. Do not combine unrelated UI, audio, account, and infrastructure work just because it is all pending.

Before committing, inspect the staged diff for unrelated work, accidental omissions, and secrets. Run checks appropriate to the change; report what was actually verified. Preserve user changes and hooks. Amend history only when requested or already authorized; an amendment is not permission to force-push. Publishing images and deploying remain separate actions from committing.

Use a short body when the reason for a change or an important limitation would otherwise be unclear. Summarize the resulting commits by hash and purpose when finished.
