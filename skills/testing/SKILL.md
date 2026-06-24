---
name: testing
description: >-
  Write and review tests that match this project's conventions, or do test-first
  development (TDD). Use when adding tests, asked to "test" a feature/endpoint/module,
  reproducing a bug with a test, or reviewing test quality. This is the central entry
  point for any testing in the repo; it routes to framework-specific guidance. Say
  "FastAPI testing" (or work on an API route / endpoint) to load the FastAPI conventions.
---

# Testing

Start here for any testing task, then load the reference that matches what
you're testing.

## Routing: load the right reference

| If the task involves…                                 | Read                                                |
| ----------------------------------------------------- | --------------------------------------------------- |
| FastAPI endpoints, API routes, the backend test suite | [references/fastapi.md](references/fastapi.md)      |

When the user says "FastAPI testing", **read `references/fastapi.md` before
writing tests.** It has the fixtures, file layout, and copy-paste templates
this repo uses.

If no reference matches (a framework not yet covered, or a brand-new project with
no existing tests), apply the general principles below and produce tests in that
shape. The point of this skill is that the output looks the same whether or not a
test suite already exists.

## Method — test-first, always

Default to a Test-Driven approach. Before implementing a feature or fixing a bug, demonstrate the intended behavior with a test, get sign-off, then implement.

The red-green-refactor loop:

1. **Red** — Write the smallest failing test that captures one behavior. Run it; confirm it fails _for the right reason_.
2. **Green** — Write the minimum code to make it pass. Nothing speculative.
3. **Refactor** — Clean up with the test as a safety net. Re-run; stay green.

Work in small steps (one behavior at a time) and surface when it's a good point to commit, rather than one-shotting a large suite.

For bugs: "Fix the bug" → "Write a test that reproduces it, then make it pass." Land the reproducing test in the **red** state first so the fix is provably what turns it green.

## General principles (framework-agnostic)

- **Arrange / Act / Assert.** Structure every test in three blocks with literal `# Arrange`, `# Act`, `# Assert` comments.
- **One behavior per test.** The test name states the behavior, not the method: `test_returns_empty_list_when_no_studies`, not `test_get_studies`.
- **Prefer real dependencies over mocks.** Set up real state (a real DB row, a real request) instead of mocking the layer under test. Mock only at genuine external boundaries (third-party APIs, the LLM, the network). A test that mocks the thing it's supposed to verify proves nothing.
- **Assert on observable behavior**, the return value or a side effect.
- **Deterministic data.** Remove any randomness from the test. Timers, random IDs, and other non-deterministic values should be fixed or mocked to a deterministic value.
- **Each test owns its setup and cleanup.** A test must pass in isolation and in any order. Don't lean on data left behind by another test.
- **Surgical scope.** Add the tests the task needs; don't refactor or "improve" neighbouring tests that aren't part of the request.

## What good looks like

A reviewer should be able to read one test and understand:
- What state was set up. Always prefer explicit setup over implicit, global assumptions. When using test data builders, always display critical values to the test in the case itself, not hidden in a builder.
- What action was taken. Always prefer one call to the code under test, rather than multiple calls or a complex sequence.
- What the expected outcome is. It should be clear how asserted values relate to the action and the setup.
