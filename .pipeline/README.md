# .pipeline

Working directory for a 4-agent dev pipeline: **planner → coder → tester → reviewer**.

Each agent reads and writes to a shared file so state carries forward between stages:

- **specs.md** — written by the planner. Requirements and task breakdown for the coder to implement.
- **changes.md** — written by the coder. Summary of the changes made and files touched.
- **tests.md** — written by the tester. Test results and coverage notes based on changes.md.
- **review.md** — written by the reviewer. Findings and feedback based on specs.md, changes.md, and tests.md.

Agents should read the files relevant to their stage before acting, and append/update their own file when done.
