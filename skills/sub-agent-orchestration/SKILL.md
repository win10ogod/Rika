---
name: sub-agent-orchestration
description: Use when a task benefits from independent parallel research, implementation, review, comparison, or specialist model routing through Rika's sub-agents.
---

# Sub-agent Orchestration

Use delegation only from the main Rika agent; a child agent cannot create another child.

1. Split work into independent, bounded tasks with explicit deliverables and validation criteria.
2. Omit `model` to reuse the current main AI source. Set `model="dedicated"` only when the configured sub-agent source is intentionally required.
3. Dispatch independent tasks together so they can run concurrently. Do not impose an invented agent-count, context, tool, or output limit.
4. Treat child reports as evidence to verify and synthesize, not as messages to forward blindly.
5. If dedicated routing is unavailable or fails, report that exact failure; never disguise a fallback to the main model.

Skills remain available inside child agents for their own assigned work.
