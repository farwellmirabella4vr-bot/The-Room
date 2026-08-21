---
description: Run a feature request through the full planner -> coder -> tester -> reviewer pipeline
argument-hint: <feature request>
---

Feature request: $ARGUMENTS

Run this feature request through the 4-stage dev pipeline defined in `.claude/agents/` (planner, coder, tester, reviewer). Each stage is a separate subagent invoked via the Task tool. Run them in strict order, one at a time — do not start a stage until the previous one has finished and its output file has real content. Do not skip a stage or run them in parallel.

1. **planner** — Invoke the `planner` subagent with the feature request above as its task. It must write a complete spec to `.pipeline/specs.md`. Read the file afterward to confirm it's non-empty before continuing.
2. **coder** — Invoke the `coder` subagent. Tell it to read `.pipeline/specs.md` and implement it. It writes a summary to `.pipeline/changes.md`. Confirm the file is non-empty before continuing.
3. **tester** — Invoke the `tester` subagent. Tell it to read `.pipeline/changes.md` (and `.pipeline/specs.md` for the edge case list) and write + run tests, recording results in `.pipeline/tests.md`. Confirm the file is non-empty before continuing.
4. **reviewer** — Invoke the `reviewer` subagent. Tell it to read `.pipeline/specs.md`, `.pipeline/changes.md`, `.pipeline/tests.md`, and a git diff, and write a verdict to `.pipeline/review.md`. It is read-only and must not modify any code.

If any stage reports it cannot proceed (e.g. missing upstream file, or in the reviewer's case a BLOCKED verdict due to failing tests), stop the chain, do not invoke the remaining stages, and surface that to the user instead of pushing forward.

After all four stages complete, read `.pipeline/review.md` and give the user a concise final summary: the verdict, the key findings (if any), what files changed, and test results. If the verdict is CHANGES REQUESTED or BLOCKED, say so plainly and do not describe the feature as done or shipped.
