# jakubsob-skills

## 1.1.1

### Patch Changes

- [`ac439f5`](https://github.com/jakubsob/skills/commit/ac439f56ad6549f53307b0ada815d8a4bc2397a7) Thanks [@jakubsob](https://github.com/jakubsob)! - Route the testing skill to the Playwright and R package references. 1.1.0 shipped both reference files but `SKILL.md` only listed FastAPI in its routing table, so the skill never directed Claude to read them. Add routing-table rows and description hints for the Playwright acceptance-testing and R (`testthat`) references.

## 1.1.0

### Minor Changes

- [`f45c97a`](https://github.com/jakubsob/skills/commit/f45c97a9c6c7bec3a0c9806328835dbfe20e6fc7) Thanks [@jakubsob](https://github.com/jakubsob)! - Add a Playwright acceptance-testing reference to the testing skill. A project-agnostic guide to end-to-end tests that double as readable specs: domain-language scenarios backed by a `given_`/`when_`/`then_` DSL and a single browser-driving Driver, outcome-based naming for DSL verbs and Driver methods (Available/Present/Absent over Visible/Shown/Open), pluggable state setup via MSW mock or a real backend API, `data-testid` as the default selector, and guidance for refactoring an existing Playwright suite into the pattern.

- [`f45c97a`](https://github.com/jakubsob/skills/commit/f45c97a9c6c7bec3a0c9806328835dbfe20e6fc7) Thanks [@jakubsob](https://github.com/jakubsob)! - Add an R package testing reference to the testing skill. Conventions for testing R packages with `testthat`: the four testing layers (unit, acceptance, coverage, mutation), testing through the public interface, the recommended stack (`testthat` 3rd edition, `withr`, `checkmate`, `cucumber`, `covr`, `muttest`), test doubles via `local_mocked_bindings`, and a from-scratch bootstrapping section.

## 1.0.0

### Major Changes

- Added testing skill and FastAPI testing reference
