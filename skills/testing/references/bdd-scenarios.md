# Writing BDD scenarios (Given-When-Then)

How to write executable specifications that read as living documentation, not test scripts. Use this when authoring or reviewing Gherkin / Given-When-Then scenarios — Cucumber, SpecFlow, Behave, `pytest-bdd`, or the `given_/when_/then_` DSL in [playwright-acceptance.md](playwright-acceptance.md).

Distilled from Gojko Adzic's *Given-When-Then With Style* series (https://www.votito.com/methods/given-when-then/introduction/).

## The core idea

A scenario has two jobs: prove a behaviour works, and document what the product should do for someone who will never read the code. Everything below serves that second job. If a scenario reads like a description of the product to a business reader, it will also automate cleanly; if it reads like a UI macro or a program, it will rot.

Two rules underpin the rest:

- **Describe *what*, never *how*.** Business intent lives in the scenario; mechanics (clicks, selectors, HTTP verbs, waits, payload shapes, data setup) live in step definitions. When a scenario names a button, an endpoint, or a sleep, push it down a layer.
- **Don't program in Gherkin.** Loops, conditionals, calling one scenario from another, computed dates — anything that wants a real language belongs in the automation layer, where you have types, IDEs, and tooling. Keep the feature file declarative and readable.

## Given / When / Then, and the title

Structure each step by tense and voice — it exposes misplaced content immediately:

| Step  | Tense           | Voice   | Holds                                             |
| ----- | --------------- | ------- | ------------------------------------------------- |
| Given | past            | passive | the state that already exists; inputs and context |
| When  | present         | active  | the single action under test — minimal data       |
| Then  | future / should | passive | the observable outcome                            |

Practical tests that fall out of this:

- **Data in a `When` is a smell.** Numbers and specific values almost always belong in `Given`. The `When` should be the same action across a group of related scenarios, differing only in setup.
- **One action per scenario.** If you need two `When`s, you probably have two scenarios, or setup leaking into the action.
- A sharp title can make an explicit `When` redundant — but never drop `Given`/`Then` clarity to save a line.

**Scenario titles** set the scope for the examples beneath them; write them *after* the examples so scope doesn't creep:

- Name the *purpose*, at the level you'd search for. "Choose shipping depending on order price" beats both "Item shipping" (too vague) and "Items over 50 USD use couriers" (too specific — it repeats example data and breaks when the threshold changes).
- Don't recite example values, don't explain the business logic (that's what the description is for), and don't cross-link work items into the title — use tags.

**Feature descriptions** should *not* be forced into "As a… I want… So that…". User-story format is for planning work, not documenting a feature that outlives the story. Use free-form prose to state purpose, spell out tricky business rules, record scope decisions and exclusions, define terms, and answer the questions a reader will have.

## Choosing examples

- **Test boundaries, not partitions.** Edge cases are where the meaning of a concept changes, and where misunderstandings hide. Show the transition points (5, 6, 9, 10, 19, 20…) rather than many interchangeable values from the middle of a range.
- **Add a context column.** Pair each boundary value with the rule it demonstrates ("6 to 9", "10 to 19") so the table teaches the business rule, not just the numbers.
- **Chat–Choose–Check.** Use lots of examples to *explore* a rule in conversation, *choose* the key ones for the acceptance criteria, and *keep* the boundaries in the automated checks.

## Structuring and grouping

- **Group into 3–10 related cases**, each covering one rule, question, or boundary. Lead with a simple happy-path "framing" scenario before the complex ones.
- **Scenario Outlines isolate variation.** Keep shared context in the `Given/When/Then`; put only what differs in the `Examples` table, and delete columns whose value never changes.
- **Split one outline's examples into several labelled `Examples:` blocks** (simple → complex). This fights reader fatigue, and you can tag a block (e.g. `@smoke`) to run a representative subset without duplicating rows — one source of truth, fast feedback when you want it.
- **`Rule:` blocks** group related scenarios under a heading while sharing a `Background`.

### Common preconditions: Outline vs Background vs Hooks

Ask: *is this context needed to understand the scenario, or only to execute the test?*

- **Scenario Outline** — shared structure, values vary; keeps preconditions visible next to their effect.
- **Background** — context shared across differently-shaped scenarios and *relevant to the outcome* (e.g. a rating scale). Keep it short and memorable.
- **Hooks** (tagged) — hidden technical coordination that doesn't affect business meaning: DB transactions, user creation, cleanup. Works across files, applied by tag.

When any of these grows unwieldy, that's the signal to split into more feature files.

## Setting up state and complex data

- **Push complexity into code, keep the scenario thin.** Object network too deep to spell out? Use a factory invoked from a single readable step (`Given a "not-delivered" refund request`) that builds all transitive dependencies. Options along a spectrum: **object factories** (in-memory), **golden-source databases** (pre-seeded reference data, wrapped in a rollback transaction), and **object finders** (query-or-create, best isolation for parallel runs).
- **Prefer declarative setup over imperative steps.** `Given an order pending a payment method`, not a click-by-click sequence to reach that state — the automation can then optimise the path.
- **Denormalise to the level under test.** If transactions are the focus, give a transactions table and let automation create the owning users/accounts. Show aggregates ("2 users with 3 transactions each") when individual rows don't matter. Optimise for reading.
- **"Doesn't exist" → describe what *does*.** Instead of "Given user John does not exist", name a concrete entity and list its contents: "Given a user repository with the following users: …". Ask the extreme question ("what does *not exist* even mean here?") to surface the real domain concept.
- **Chain entities for genuine hierarchy.** When the whole tree matters, establish each level in turn so later rows implicitly attach to earlier context — rather than one giant nested table.
- **External data / messages: apply single responsibility.** Don't demonstrate parsing, business logic, and formatting in one scenario. Introduce an internal business model and test the three concerns separately; keep the full XML/JSON template in the step definitions and put only the fields that matter in the table.

## Keeping scenarios independent

Chains where scenario B depends on the side effects of scenario A are the classic maintenance trap.

- Group by **business rule, not execution order**; give the group a `Background` so each scenario runs standalone.
- One topic per file — separate topics evolve independently.
- Use **declarative state** so automation can reach setup directly instead of replaying prior scenarios.
- **Split validation from processing** — testing *whether* input is valid vs *how* valid input is processed — to avoid a cartesian blow-up of cases.
- Don't try to **call one scenario from another** (no tool supports it, and it's programming in Gherkin). Instead raise the step to a higher-level concept (`Given a user is logged in`) and reuse the mechanics in a utility/driver layer. Keep three abstraction levels: business rules → workflows → technical activities.

## Handling the awkward cases

- **Pauses and timeouts** — never `And the system waits 3 seconds`. Wait for events/conditions in the step code. If a time limit is a real *business* rule ("must complete within 3 minutes"), state it, but drive it with a controllable business clock, not a real sleep.
- **Relative periods / dates** — prefer hard-coded explicit dates ("8 October 2020") over formulas like `TODAY − 1 month`. A formula duplicated between test and production can drift; explicit dates make leap years, month lengths, and DST edge cases visible. State the accuracy needed (day, minute).
- **Randomness** — don't test the RNG. Set strict scope, isolate the source of variability, and feed a deterministic sequence: `And the random number generator produces: 1.0, 0.9, 0.4 …`. Ship a certified RNG in production and a predictable one for tests.
- **"User should NOT be able to…"** — model the *allowed actions* explicitly, don't describe a greyed button. Split into three specs: validation rules (what's valid), allowed actions (what a user in this state may do), and UI impact (how each control reflects that). Business rules then stay independent of web/mobile/API.
- **Complex workflows** — a two-tier split: one *flow* feature file proving the transitions along representative paths (the flow is *what's* tested), plus a focused feature file per step for its boundaries and failure modes. Turns thousands of combined cases into ~a dozen small files.

## Readability

Long feature files go monotonous. Tools to break it up: use `*` bullets for a group of steps instead of repeating keywords; fold repetitive steps into inline data tables (horizontal or vertical); split a long `Examples` table into labelled blocks; group with `Rule:`; and apply light markdown (`**bold**`, links) in descriptions.

**Highlight the parameters** so readers can see what can change — if they can't spot the variable, they can't ask the good "what about…?" questions: scenario-outline placeholders, quotes around values (`"open"`, `"100 USD"`), end-of-line positioning after a colon, or a step-parameter table for multi-attribute values.

When a scenario is simply confusing, **don't guess the intent — ask the team.** Recover the business purpose through conversation first, then rewrite.

## UI and API scenarios

Same principle, applied at the two boundaries where people most often leak mechanics:

- **UI:** think user functionality, not clicks. `When I provide my user name as "foobar"`, never `When I type "foobar" into "tbUserName"`. First decide the risk you're covering — UI fragility vs correctness of expectations — since that decides whether any UI term belongs in the scenario at all. Isolate the domain from the interface (page objects / screenplay / hexagonal).
- **API:** move along the spectrum from full JSON/XML bodies → only the relevant fields → path pointers for values that differ from defaults → pure behaviour ("a post is shared for the user with the message"). Prefer the most abstracted form the test can afford; keep endpoints, verbs, and payload shape in the step definitions.

## BDD scenarios vs unit tests

It isn't either/or. Some duplication between a BDD spec and a unit test is fine. Use scenarios for behaviour that a business reader should own and read as documentation; use unit tests for technical detail, exhaustive edge exploration, and anything whose failure only a developer would triage. A useful deciding question for where an example belongs: *who would need to decide about fixing this if it failed?* Push purely technical or exploratory cases down into unit tests or a sandbox.

## Organizing feature files

There's no one right layout (by story, by functional area, by capability, by component…). The rule that matters: **pick a structure and stay consistent** — for any non-trivial project, consistent organization is what makes the suite usable as living documentation.

## Quick review checklist

- [ ] Title names the purpose at search level; no example data, no logic, no work-item links.
- [ ] `Given` past/passive (state), `When` present/active (one action, minimal data), `Then` future/passive (observable outcome).
- [ ] No mechanics in the scenario — no clicks, selectors, endpoints, sleeps, or payload shapes.
- [ ] No programming in Gherkin — no loops, conditionals, or scenario-to-scenario calls.
- [ ] Examples sit on boundaries, with a column naming the rule each one shows.
- [ ] Outline `Examples` contain only what varies; shared context is in the steps/Background.
- [ ] Setup is declarative and independent; the scenario passes in isolation and in any order.
- [ ] Parameters are visually distinct so a reader can see what can change.
