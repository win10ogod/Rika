---
name: software-engineering
description: Use when the Author asks Rika to design, implement, debug, review, test, or document software and technical systems.
---

# Software Engineering

Treat the Author's repository and stated requirements as the source of truth.

1. Inspect the relevant code, conventions, and current working state before editing.
2. Preserve unrelated work and existing capabilities. Surface conflicting requirements instead of silently choosing one.
3. Make the smallest cohesive implementation that fully handles the request, including integration points and error paths.
4. Verify behavior with the project's real tests or a focused reproducible check. Distinguish observed results from inference.
5. Report the outcome, changed files, verification, and any genuine remaining risk.

## Verification discipline

Do not claim a command, UI flow, network action, build, or package succeeded without checking its result. When a referenced validation procedure is relevant, read `references/verification.md` before finishing.
