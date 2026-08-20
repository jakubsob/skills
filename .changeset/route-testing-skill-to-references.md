---
"jakubsob-skills": patch
---

Route the testing skill to the Playwright and R package references. 1.1.0 shipped both reference files but `SKILL.md` only listed FastAPI in its routing table, so the skill never directed Claude to read them. Add routing-table rows and description hints for the Playwright acceptance-testing and R (`testthat`) references.
