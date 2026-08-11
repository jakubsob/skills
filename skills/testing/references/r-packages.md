# R package testing conventions

Patterns for testing R packages with `testthat`. If the package already has a suite, match its existing structure, helpers, and naming; the names below are illustrative, not prescriptive. If you're starting fresh, the "Bootstrapping from scratch" section builds the pieces these patterns assume.

The guiding idea, from which everything else follows: **a test is a user of your code.** It calls a function, passes arguments, expects a result — exactly like a real caller. So friction while testing is diagnostic feedback about the *design*, not a chore to mock away. Code that is hard to test is hard to use. Two questions decide what to write and whether to trust it:

- **"If this code were wrong, would I know?"** — decides whether a test is worth writing.
- **"If this fails at 2am, will I understand what broke and why?"** — decides whether a test is any good.

## Four layers, four jobs

A well-tested package stacks four complementary layers. Each catches what the others miss; none is optional on code that matters.

| Layer | Question it answers | Tool |
| ------------------- | ---------------------------------------------------- | ---------- |
| **Unit tests** | Is each function built correctly? (logic, edges) | `testthat` |
| **Acceptance tests** | Did we build the correct thing? (user-facing behavior) | `cucumber` |
| **Coverage** | What did the tests never execute? | `covr` |
| **Mutation testing** | Would the tests notice if the code were wrong? | `muttest` |

Coverage tells you which lines *ran*; mutation testing tells you which lines ran *without being verified*. They are different jobs — see [Coverage & mutation testing](#coverage--mutation-testing).

## Test through the public interface

Drive code through its **exported functions** — the contract users depend on — and assert on return values or observable side effects. This exercises the real call path and leaves you free to refactor internals without rewriting tests. Chase "confidence that it solves the problem," not "confidence that it's implemented a particular way."

Test an internal (unexported) function directly only when it carries **non-trivial logic the public path can't exercise exhaustively**: a branchy parser, an edge-case-heavy pure function, the core algorithm. That's the exception (e.g. `muttest` tests each mutator directly, because mutators *are* the logic), not the default. Don't carpet-bomb every one-line helper with its own test — if the high-level function works, a trivial helper it calls works too, and testing it directly just freezes an implementation detail. When in doubt about adding an internal-only test, ask first.

## The stack

- **`testthat`** (3rd edition — `Config/testthat/edition: 3` in `DESCRIPTION`). Both `describe()`/`it()` and flat `test_that()` are idiomatic; match the file you're in.
- **`withr`** for scoped, self-reverting state (`local_*` / `with_*`): options, env vars, temp dirs, the RNG seed, working directory. This is how tests stay isolated.
- **`checkmate`** for argument assertions in package code (shows up as the thing under test, not a test tool).
- **`cucumber`** — Gherkin `.feature` files + R step definitions for acceptance/BDD tests. (Author's own package.)
- **`covr`** for coverage; **`muttest`** for mutation testing. (Both the author's own packages.)
- **Test doubles**: prefer plain injected functions/lists and `testthat::local_mocked_bindings()` (testthat ≥ 3.2.0). Reach for `mockery` only for legacy code or cases `local_mocked_bindings` can't reach.

## Layout

```
tests/
  testthat.R                 # runner: testthat::test_check("<pkg>")
  testthat/
    test-<topic>.R           # one file per source file / behavior area
    setup-<x>.R              # setup: builders, custom expectations, fixtures (auto-loaded)
    helper-<x>.R             # helper functions available to tests (auto-loaded)
    _snaps/                  # snapshot files (managed by testthat)
  acceptance/                # cucumber acceptance tests (kept separate from unit tests)
    <feature>.feature        # Gherkin specification
    setup-steps.R            # step definitions (given/when/then/before/after)
    setup-<driver>.R         # driver / DSL + helpers
```

- **`setup-*.R` and `helper-*.R` are sourced automatically** before tests run — put builders, custom expectations, and shared helpers there. No `source()` needed.
- **One `test-<topic>.R` per source file** is the default (`R/tokenize.R` → `test-tokenize.R`). `usethis::use_test("tokenize")` creates it.
- Keep acceptance tests in **`tests/acceptance/`**, separate from `tests/testthat/`, so unit and acceptance layers run and read independently.

## Method — test-first, always

Default to Test-Driven Development. Open the **test file before the implementation file** — that habit is most of the discipline.

The red-green-refactor loop:

1. **Red** — Write the smallest test that captures one behavior. Run it; confirm it fails _for the right reason_. Skipping this step forfeits the whole point: a test written after the code is written to pass, not to catch anything.
2. **Green** — Write the minimum code to pass. Nothing speculative — YAGNI.
3. **Refactor** — Clean up with the test as a safety net. Re-run; stay green.

Sketch the spec as **empty `it()` blocks first** — they show up as skips and become your to-do list:

```r
describe("fee_waiver", {
  it("should waive fees for verified accounts with orders over 500", {
    # not implemented yet
  })
  it("should NOT waive fees for unverified accounts even over 500", { })
  it("should NOT waive fees for verified accounts at exactly 500", { })
})
```

Run the file you're editing (`testthat::test_file("tests/testthat/test-fee-waiver.R")`) during the loop; the full suite (`devtools::test()`) at commit time. When a Slack thread settles a boundary ("is 500 inclusive?"), encode the answer as a test — that conversation then lives in the suite forever.

For bugs: "Fix the bug" → "Write a test that reproduces it, land it **red**, then make it green." The reproducing test is what proves the fix is the fix, and it's a permanent regression guard.

### The flipped loop when an LLM writes the code

**Let the AI write the code; the tests decide whether to keep it.** The tests are one artifact doing two jobs: the *specification* you hand the model, and the *gate* that verifies its output. The model is fast at the part that needs no supervision (turning a spec into code) precisely because you were slow and deliberate about the part that needs judgment (deciding what "correct" means, written as concrete values).

1. **You write the tests** — encode the real requirements, including domain rules the model can't know (a "verified account" means identity-verified *and* not flagged in 90 days; this quarter's pricing table; last quarter's off-by-one).
2. **Hand the failing suite to the model** and ask for the minimum implementation that passes. A prompt that works: *"Here are R tests using testthat. Write the minimum implementation that makes all tests pass. Do not add behavior not covered by the tests. If any test reveals an ambiguity, point it out."*
3. **Run the tests. Read the failure, not the code.** Green means every condition you pinned was honored. Red means you caught it before it shipped.

Two things you must get right in the tests, because the model won't:

- **Encode domain knowledge as in-test comments** — the "why" the model can't infer: `# advisory does not downgrade from critical — volume is the driver`.
- **Make boundary values explicit** — test *exactly* 100000 and *exactly* 10000, not a vague "large" input. The model implements `>= 100000` because your test said so.

Writing the test first also surfaces missing requirements ("what if `downloads` is negative? what if `has_advisory` is `NA`?") — decide and encode them rather than letting the model silently coerce `NA` and fall through. Treat AI-written **R** with extra scrutiny; and after generating any tests, run [the review checklist](#reviewing-ai-generated-tests) and `muttest`.

## Anatomy of a unit test

### Structure: `describe`/`it` or `test_that`

Group behaviors of one unit under `describe("<unit>", { it("should <behavior> when <condition>", …) })`; use flat `test_that("<unit> should <behavior> …", …)` where nesting adds nothing. Both read as sentences — that's why `test_that` is named the way it is.

### Always label Arrange / Act / Assert

Every test does exactly three things, marked with literal comments:

```r
it("should return the last pushed value when popping", {
  # Arrange
  stack <- Stack$new()
  stack$push(1)

  # Act
  value <- stack$pop()

  # Assert
  expect_equal(value, 1)
})
```

The comments are a **smell detector**. More than one thing in `# Act` (multiple calls to the code under test), or unrelated assertions piled under one `# Assert`, means the test does too much — split it. For error-only tests where the call *is* the assertion, collapse to `# Act & Assert`:

```r
it("should error when input is not numeric", {
  # Arrange
  input <- "a"

  # Act & Assert
  expect_error(factorial(input), "must be numeric")
})
```

Keep `# Arrange` minimal — if you're adding fields "just in case," you're designing the implementation, not the test.

### One behavior, one call

One `test_that`/`it` verifies **one behavior**, with **one call** to the code under test. Multiple `expect_*` on the *same* behavior (a discount's `pct` and `final`) is fine; assertions spanning *different* contract aspects must be split, so a failure names exactly which behavior broke. When counting cases, use **chicken counting** — zero, one, many — never enumerate 0, 1, 2, 3, 4.

### Titles are specifications

Write the title **before** the body: if you can't name what you're testing, you don't know what you're testing yet. A title states **the behavior and the condition**, and must still make sense if the implementation were rewritten. Reject titles that end in "works" / "is correct" / "handles input", or that are just the function name — the swap test: if a title could be swapped onto any other test of the same function without anyone noticing, it's a placeholder, not a title.

```r
# Bad
test_that("calculate_discount works", { … })
# Good
test_that("discount is 10% for gold tier orders over 100", { … })
```

## Assertions — assert on values, not shapes

An assertion is only as good as what it would *catch*. The practical test of strength: **would this assertion still pass if the function body were replaced with `return(list())`?** If yes, it's too weak.

- **Assert specific values**, not types or structure. `expect_type(result, "list")` and `expect_true(is.data.frame(x))` pass for a totally broken function — they test that R's type system still works. Assert `expect_equal(result$discount_pct, 0.10)`.
- **`expect_error()` / `expect_warning()` always take an expected message** (a regex or `class =`). A bare `expect_error(f())` passes on *any* error, including the wrong one.
- **Match the assertion to intent.** `expect_setequal()` when order is incidental; a tolerance for floats; `expect_snapshot(err, error = TRUE)` to pin a user-facing message.
- **Don't duplicate assertions.** If `expect_equal()` on a vector already covers it, adding `expect_length()` buys nothing.
- **Custom expectations** capture a domain-specific check once and read cleanly everywhere. Define them in `setup-*.R`:

```r
# tests/testthat/setup-expect.R  (from muttest)
expect_mutates_to <- function(mutator, input, expected_list) {
  mutations <- mutator$mutate(input)
  expect_equal(mutations, expected_list)
}
expect_no_mutations <- function(mutator, input) {
  expect_null(mutator$mutate(input))
}
```

## Isolating dependencies

Prefer, in order — the earlier you can stop, the better the design:

1. **Refactor so there's nothing to fake.** Make hidden inputs explicit parameters, and split I/O from computation so the logic is a pure function you test with plain inline data. Most "how do I mock this?" questions dissolve here.
2. **Dependency injection** — pass the collaborator as an argument, defaulting to the real implementation. Production is unchanged; the test injects a plain fake:

    ```r
    convert_price <- function(price_eur, currency, get_rate = fetch_exchange_rate) {
      round(price_eur * get_rate(currency), 2)
    }

    test_that("price is converted at the given rate and rounded to 2dp", {
      # Arrange
      fake_rate <- function(currency) 1.08   # deterministic, no HTTP

      # Act
      result <- convert_price(100, "USD", get_rate = fake_rate)

      # Assert
      expect_equal(result, 108)
    })
    ```

3. **Own the interface, then fake your own function.** Wrap any dependency that touches the outside world or is likely to change — `Sys.time()`, HTTP, DB, filesystem, an LLM call — in a thin package-local function. Now you can replace it in tests with `testthat::local_mocked_bindings()`, which only rebinds names **in your own package's namespace**:

    ```r
    get_current_time <- function() Sys.time()          # the wrapper you own

    is_business_hour <- function() {
      h <- as.integer(format(get_current_time(), "%H"))
      h >= 9 && h <= 17
    }

    test_that("is_business_hour is TRUE during the day", {
      # Arrange
      local_mocked_bindings(
        get_current_time = function() as.POSIXct("2024-01-01 14:00:00")
      )
      # Act, Assert
      expect_true(is_business_hour())
    })
    ```

    Avoid the `.package` argument — its absence is the point. Being unable to mock `base::Sys.time()` directly is what pushes you to wrap it, which is the better design anyway. Time specifically has no `set.seed()` equivalent; you *must* replace the source.

**Mock only at genuine external boundaries, and never mock the code that could contain the bug.** A mock returns what *you* assumed the real thing returns, so a passing mocked test only confirms your assumption back to you. The classic trap — `local_mocked_bindings(fetch_temperature = function(id) 23.5)` — skips the very unit-conversion code where the Kelvin-vs-Celsius bug lives, so the test is green and production is wrong. Integration-level correctness is the job of acceptance tests, not mocked unit tests.

### The five test doubles

Name them precisely; pick by job. Prefer a **stub** (assert on the resulting value/state) over a **mock** (assert on the interaction) — interaction assertions couple the test to *how* the code works and break on harmless refactors (the over-specification smell).

| Double | Records calls | Returns canned values | Use when |
| ------ | :-----------: | :-------------------: | -------- |
| Dummy | — | — | Fill a required parameter you won't touch |
| Stub | — | ✅ | Control what the code receives; assert on the outcome |
| Spy | ✅ | — | Assert a side effect happened (a log, a notification) |
| Mock | ✅ | ✅ | Pin an exact interaction as a contract (use sparingly) |
| Fake | — (has real behavior) | — | Replace a stateful / multi-call dependency (in-memory DB) |

All are plain R — a stub is a `list(charge = function(...) …)`; a spy appends to a captured variable with `<<-`. A **fake** is a working stand-in with real behavior; reuse it to power a dev mode of the app, and to keep acceptance tests off fragile external services.

## Test data builders

Don't construct domain objects field-by-field in tests — 16 fields of noise to vary the one that matters buries the point and breaks every test when a field is added. A **builder** is a function with sensible defaults for everything; the test states only what's different:

```r
# tests/testthat/setup-builders.R
build_patient <- function(id = "P001", age = 30, consented = TRUE, site_id = "S01") {
  list(id = id, age = age, consented = consented, site_id = site_id)
}

# in a test — the age is the whole point of the scenario
patient <- build_patient(age = 17)
```

Prefer builders over shared fixtures (a fixture is global mutable state one test can corrupt for the next; a builder returns a fresh object each call). Bake **domain invariants** into a builder (a completed study must have an end date); never bake **test-specific** logic (`if (for_eligibility_test) …`) — that's the builder making decisions that belong to the test. A 40-argument builder is a signal the *domain object* has too many concepts, not that builders are wrong. For DB-backed acceptance tests, a builder seeds the row, returns the object, and registers its own teardown:

```r
db_build_study <- function(db, id = "STDY-01", status = "recruiting", envir = parent.frame(), ...) {
  DBI::dbExecute(db, "INSERT INTO studies (id, status) VALUES (?, ?)", params = list(id, status))
  withr::defer(DBI::dbExecute(db, "DELETE FROM studies WHERE id = ?", params = list(id)), envir = envir)
  list(id = id, status = status, ...)
}
```

Prefer `withr::defer()` over a `teardown-*.R` file — it's co-located with the setup and runs even if the test fails.

## R6 interfaces for testable design

When business logic depends on a fragile collaborator (DB, API, ML model), depend on a **contract**, not a concrete class. Define an R6 interface whose methods `rlang::abort()`, then supply a **real** implementation and a **fake**, both inheriting it; select via a factory driven by config:

```r
AnalyzerInterface <- R6::R6Class("AnalyzerInterface", public = list(
  initialize = function() rlang::abort("Cannot instantiate an interface."),
  risk_score = function(customer_id) rlang::abort("Not implemented.")
))

AnalyzerFake <- R6::R6Class("AnalyzerFake", inherit = AnalyzerInterface, public = list(
  initialize = function() {},
  risk_score = function(customer_id) 0.3          # canned, deterministic
))

make_analyzer <- function(type = c("real", "fake")) {
  switch(match.arg(type), real = Analyzer$new(), fake = AnalyzerFake$new())
}
```

Test the **real** implementation for logic correctness; test the **fake** only for contract conformance (right type/shape). Then drive acceptance tests with the fake (`withr::with_envvar(c(ANALYZER_TYPE = "fake"), …)`). The rule: **don't test the same logic twice** — verify business logic once against the real class, and use the fake to keep the acceptance layer fast and reliable.

## Snapshot testing

Snapshot testing captures serializable output to a file and diffs it on later runs — for output too large or too visual to assert field-by-field (a rendered plot, a formatted CLI report, a wide data frame, an error message). It is **not** just for images.

The danger that governs every rule below: with a snapshot, **you are the test oracle** — there's no `expect_equal(x, 42)` stating the answer. The first snapshot is a *decision*, not a fact; accepting one unread makes the test assert only "the code does whatever it currently does," which is nothing.

- **Use it only when code can't cleanly describe the expected value.** A scalar or boolean belongs in `expect_equal()`; a 40-line field-by-field `expect_equal()` on a big nested object belongs in a snapshot. If a few lines of R can express the expected object, put it in the test.
- **Keep snapshots human-readable text** — `.md`, `.csv`, `.svg`, JSON. **Never binary or `.rds`**: the whole technique rests on a human (you, and your PR reviewer) reading the recorded output and judging it correct.
- **Remove nondeterminism at the source** (inject a fixed clock/seed/IDs); for what remains, strip it with `transform`. Bake the cleaning into a wrapper so every test inherits it:

    ```r
    # tests/testthat/setup.R  (from muttest / cucumber)
    .expect_snapshot <- purrr::partial(
      testthat::expect_snapshot,
      transform = function(lines) {
        lines |>
          stringr::str_subset("^[\\|/\\-\\\\] \\|", negate = TRUE) |>  # drop spinner frames
          stringr::str_remove_all("\\s\\[\\d+.\\d+s\\]")               # drop [0.3s] timings
      }
    )
    ```

- **Scope tightly, name descriptively, stabilize platforms.** Capture the plot, not the dashboard around it. Name the test by precondition + expected output. Use `variant =` to store per-OS/per-version renders side by side. Prefer **SVG over PNG** (`vdiffr::expect_doppelganger()`) — viewable as an image *and* diffable as text.
- **Review, never blind-accept.** `testthat::snapshot_review()` opens a diff app — that's the honest path. `testthat::snapshot_accept()` without looking is how snapshot suites rot. Treat a changed snapshot in a PR with the same scrutiny as a changed function.

`expect_snapshot(code)` records into `_snaps/<file>.md`; `expect_snapshot_file()` for named image/CSV files; `expect_snapshot_error()` to pin an error message.

## Acceptance testing with cucumber (BDD)

Acceptance tests prove the package delivers user value and document what it should do, in language a non-programmer can verify. A `.feature` file describes behavior in Gherkin; step definitions in R execute it. State flows between steps through a `context` object; `before`/`after` hooks handle setup and teardown.

**A `.feature` file** — business language, no implementation detail:

```gherkin
# tests/acceptance/eligibility.feature
Feature: Trial eligibility
  Scenario: An underage patient is not eligible
    Given a patient aged 17
    And a study with a minimum age of 18
    When eligibility is assessed
    Then the patient should not be eligible
```

**Step definitions** — `given`/`when`/`then` take the parameters matched in the text plus a trailing `context`. `{int}`, `{float}`, `{word}`, `{string}` are extracted and cast automatically. Assertions inside `then` are ordinary testthat expectations:

```r
# tests/acceptance/setup-steps.R
before(function(context, scenario_name) {
  context$patient <- NULL
  context$study <- NULL
})

given("a patient aged {int}", function(age, context) {
  context$patient <- build_patient(age = age)
})

given("a study with a minimum age of {int}", function(min_age, context) {
  context$study <- build_study(min_age = min_age)
})

when("eligibility is assessed", function(context) {
  context$result <- is_eligible(context$patient, context$study)
})

then("the patient should not be eligible", function(context) {
  expect_false(context$result)
})
```

Run with `cucumber::test("tests/acceptance")`. Each Feature reports like a `test-*.R` context; each Scenario like a `test_that` case.

Both `cucumber` and `muttest` test *themselves* this way — a real `muttest` acceptance scenario writes a tiny package to a temp dir, runs `muttest()` on it, and asserts the score:

```gherkin
  Scenario: comparison_operators preset kills a boundary mutation
    Given I have a "R/check.R" file with
      """
      is_adult <- function(age) age >= 18
      """
    And I have a "tests/testthat/test-check.R" file with
      """
      test_that("18 is adult",    { expect_true(is_adult(18)) })
      test_that("17 is not adult", { expect_false(is_adult(17)) })
      """
    When I run mutation tests with
      """
      muttest(plan = muttest_plan(mutators = comparison_operators()))
      """
    Then the mutation score should be 1.0
```

**Cadence — write few, high-value scenarios.** Write the **golden scenario** first (the system's core promise), then the second most valuable behavior. Two or three scenarios capture the bulk of user value; by the fifth you're chasing edge cases that belong in fast unit tests. **Push edge cases down** — special characters, empty inputs, error branches, off-by-one boundaries are unit-test territory. The litmus test for a scenario: *"if this broke, would a user miss it?"*

**Keep scenarios implementation-free.** No function names, no UI clicks, no data types — a scenario should read true no matter how the system is built (imagine implementing it as a CLI, an API, or "mind control"; the spec shouldn't change). Health metric: your library of steps should grow *slower* than your set of scenarios. If steps aren't being reused, they're leaking implementation detail — make them more abstract but still precise, using parameter types to build a small shared vocabulary.

## Coverage & mutation testing

**Coverage is a map, not a goal.** `covr::package_coverage()` tells you which lines *executed* — nothing about whether any assertion verified anything. You can delete every `expect_*` call, keep the code that runs, and still see 100%. So:

- Use coverage to find code with **no tests at all**, to spot **dead code**, and to flag a **coverage drop in a PR** ("+200 lines, −3 points — what didn't get tested?"). Alert on drops; don't block on an absolute number.
- Treat **100% as suspicious, not reassuring** — it usually means tests written to satisfy the number. Investigate, don't celebrate. Below ~40% on business logic is a real problem; above ~80% is table stakes that says nothing about assertion quality.

**Mutation testing measures assertion quality** — the thing coverage is blind to. `muttest` makes a small, deliberate change to your source (`>=` → `>`, `TRUE` → `FALSE`), reruns the suite, and checks whether a test fails:

```r
plan <- muttest::muttest_plan(
  source_files = "R/eligibility.R",
  mutators = c(
    comparison_operators(),   # < > <= >= == !=
    logical_operators(),      # && || &  |
    condition_mutations()     # negate / de-negate if & while conditions
  )
)
muttest::muttest(plan)
```

- Mutant **killed** (a test failed) = good. Mutant **survived** (suite still green) = a bug your tests can't see. Score = killed / total.
- **A surviving mutant is a specification you forgot to write.** The canonical case: three "reasonable" tests for `age >= 18 && income <= 30000` hit 100% coverage but never test *exactly* 18 or *exactly* 30000, so `>=` → `>` survives — a real off-by-one the suite would miss. Fix by adding the boundary test, which now encodes the business decision forever.
- **Run it on one critical file at a time**, not the whole package. Target **~80%+ on business logic**, not 100% everywhere — some survivors are genuinely equivalent mutants. Add mutator families only for constructs the file actually uses (`don't run every mutator on every file`).
- **It is the objective backstop for AI-written tests**, which are syntactically fine and green but systematically undertest boundaries. Workflow: **generate → mutate → fill the gaps the survivors reveal.**

## Reviewing AI-generated tests

LLM-written tests look right, use the right functions, and run green — and still let bugs through, because "does this look right?" (the instinct that works on production code) doesn't transfer to tests. Run these five checks on any generated test (and on your own):

1. **Specific titles.** Reject "works" / "handles valid input" / "returns correctly". The title alone must say what's verified and under what condition. Rewrite before accepting.
2. **Assertions on values, not shapes.** For each `expect_*`, ask *would it still pass if the body were `return(list())`?* Replace type/structure checks (`expect_type`, `expect_true(is.data.frame(...))`) with value assertions.
3. **Boundaries covered.** List every `if / > / < / >= / <= / ==` in the code. For each, verify a test on each side *and* exactly at the boundary. LLMs gravitate to the middle of the input space and skip the edges — where bugs live.
4. **One behavior per test.** Split dense blocks that verify several contract aspects at once, so each failure is self-diagnosing.
5. **Independence.** No file-scope mutable state shared across tests. Verify by running the file forward and in reverse (`test_file()` vs `devtools::test()` disagreeing is the tell) — differing results mean a hidden dependency.

Also check the model **didn't add code beyond what the tests require**, and **stubbed any nondeterministic boundary (an LLM/API call) and asserted on the resulting decision, never on generated text.** Then run `muttest` — manual checks find structural problems; mutation testing finds the assertion-strength gaps the checklist misses.

## Bootstrapping from scratch (no suite yet)

If the package has no tests:

1. **Set up testthat 3e**: `usethis::use_testthat(3)` — creates `tests/testthat.R`, `tests/testthat/`, and adds `Config/testthat/edition: 3` to `DESCRIPTION`. Add `withr` (and `mockery` if needed) under `Suggests`.
2. **First test**: `usethis::use_test("<topic>")` scaffolds `tests/testthat/test-<topic>.R`. Write one behavior with `# Arrange`/`# Act`/`# Assert` and a behavior+condition title; run it red, then green.
3. **Shared scaffolding as you need it**: a `setup-builders.R` for test data builders, a `setup-expect.R` for custom expectations — both auto-sourced.
4. **Coverage** when there's something to measure: `covr::report()` locally; `usethis::use_github_action("test-coverage")` for CI.
5. **Acceptance tests** once a user-facing feature exists: add `tests/acceptance/`, a `.feature` file, and `setup-steps.R`; run with `cucumber::test("tests/acceptance")`.
6. **Mutation testing** on your most critical source file once its unit tests are in place: `muttest::muttest(muttest_plan(source_files = "R/<critical>.R", mutators = comparison_operators()))`. Read every survivor.

Keep new tests visually consistent with the templates above so the suite reads as one style regardless of who — or what — wrote each test.

## Review checklist

A reviewer should read one test and know what state was set up, what single action was taken, and how the expected outcome relates to both — without opening the implementation.

- [ ] Title states the behavior and the condition, and would survive a rewrite of the implementation (no "works" / function-name-only).
- [ ] `# Arrange` / `# Act` / `# Assert` labelled; one call to the code under test; one behavior.
- [ ] Assertions are on specific values, not types/shapes — each would fail if the body were `return(list())`.
- [ ] `expect_error`/`expect_warning` specify the expected message or class.
- [ ] Boundaries tested on both sides and exactly at the edge.
- [ ] Dependencies handled by refactor → injection → owned-wrapper + `local_mocked_bindings`, in that order of preference; nothing mocks the code that could hold the bug.
- [ ] Test data comes from builders; only the field under test is stated explicitly.
- [ ] The test owns its state and passes in isolation and in any order (`withr` for scoped state, `withr::defer()` for cleanup).
- [ ] Snapshots are readable text (never `.rds`), deterministic, scoped, and were reviewed — not blind-accepted.
- [ ] Acceptance scenarios are few, high-value, and implementation-free; edge cases pushed down to unit tests.
- [ ] On critical logic: coverage checked as a gap-map (not a target) and `muttest` run with every survivor addressed.
