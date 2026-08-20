# Playwright acceptance testing conventions

Patterns for acceptance tests that double as readable specs: domain vocabulary in the test file, a DSL that translates intent into browser actions, and a Driver that knows how to execute it. Works whether you're starting fresh or refactoring an existing Playwright suite.

## The core idea

Acceptance tests have two jobs: prove a feature works, and document what it should do. This pattern keeps both in the same file. A spec describes behaviour in domain language (`given` / `when` / `then`); a `Driver` knows how to perform that behaviour by driving the real UI with Playwright. The spec never mentions pages, buttons, or selectors — so it reads as a description of the product, and a UI refactor changes the Driver, not the spec.

```text
spec (.spec.ts)          ← reads as product behaviour; no Playwright
  └─ TestDSL             ← domain verbs: given_ / when_ / then_
       └─ Driver         ← the contract; the only layer that touches Playwright
```

Two things are deliberately separate:

- **How the app is exercised** — always through the Driver. The basic implementation is `DriverUI` for driving it via browser, but you could implement other drivers if the system exposes different interfaces (e.g. API, CLI or mobile).
- **How test state is set up** — the one axis that varies. Either mock the backend with MSW and seed an in-memory store, or point at a real backend and seed it over its API. The specs and the DSL are byte-for-byte identical either way; only the `given_` implementation differs.

That second point is the payoff: you can start against a mocked backend for speed, and later run the same specs against a real server for fidelity, without touching a single scenario.

## Writing a spec

Each test is a user story in plain, past-or-present-tense business language. The title says what the product does, not what the code does — and never names a page, button, row, or dialog.

```typescript
// tests/specs/project-management.spec.ts
import { test } from "./playwright.setup";
import { TestDSL } from "../dsl/TestDSL";
import { project } from "../generators";

let dsl: TestDSL;

test.beforeEach(async ({ createDSL }) => {
  dsl = createDSL();
});

test("an admin creates a project and it appears in the portfolio", async () => {
  await dsl.given_admin_user();

  await dsl.when_user_creates_project({ name: "Alpha" });

  await dsl.then_project_is_present("Alpha");
});

test("a respondent cannot delete a project", { tag: "@user-respondent" }, async () => {
  await dsl.given_respondent_user();
  await dsl.given([project({ name: "Alpha" })]);

  await dsl.when_user_opens_project("Alpha");

  await dsl.then_project_deletion_is_not_available();
});
```

- One scenario per `test()`. The title reads as prose.
- `given_*` is a pre-condition. Seed the state the test needs. Never do setup inside a `when_`.
- `when_*` is the action under test.
- `then_*` is the observable outcome. Assert exactly what the title claims.
- Keep `given([...])` short. Pass factory-built objects (see generators), not inline literals full of irrelevant fields.
- Tag scenarios that are scoped to a role or capability (e.g. `{ tag: "@user-respondent" }`) so you can slice runs.

## Name verbs by outcome, not by UI mechanics

This is the rule that keeps specs durable. DSL verbs and Driver methods are named for the **observable outcome**, never for how the current UI happens to render it, or that there is a UI at all.

- Prefer **`_is_present` / `_is_absent` / `_is_available` / `_is_not_available`** over `_is_visible`, `_is_shown`, `_is_open`, `_is_displayed`.
- `then_project_deletion_is_not_available()`, not `then_delete_button_is_hidden()`.
- `then_previous_assessment_is_present()`, not `then_assessment_panel_is_shown()`.

Two reasons. First, a title that says "is not available" stays true whether the control is hidden, disabled, or absent from the DOM — so a UI redesign doesn't invalidate the spec's meaning. Second, if a `then_` reads persisted state instead of the screen (common when you seed via a real API), an outcome-shaped name still fits; a rendering-shaped name would lie. Reserve "visible/shown/open" for the rare assertion that is genuinely, specifically about rendering.

## The DSL class

`TestDSL` is a thin orchestration layer that holds a `Driver` and exposes domain-named methods. It never contains raw Playwright — no `Page`, no selectors.

```typescript
// tests/dsl/TestDSL.ts
import { expect } from "@playwright/test";
import { Driver } from "./Driver";

export class TestDSL {
  // A little scenario-local context is fine — remembering the "current" entity
  // between a when_ and a then_ keeps call sites clean. Keep it small.
  private context: { projectName: string | null } = { projectName: null };

  constructor(private readonly driver: Driver) {}

  async given_admin_user(user?: UserInfo) {
    this.driver.patchState({ user: user ?? DEFAULT_ADMIN });
  }

  async given_respondent_user(user?: UserInfo) {
    this.driver.patchState({ user: user ?? DEFAULT_RESPONDENT });
  }

  async given(projects: Project[] = [], assessments: Assessment[] = []) {
    this.driver.patchState({ projects, assessments });
  }

  async when_user_creates_project(data: { name: string }) {
    await this.driver.openCreateProject();
    await this.driver.defineProject(data);
    await this.driver.saveProject();
  }

  async when_user_opens_project(name: string) {
    this.context.projectName = name;
    await this.driver.navigateToProjects();
    await this.driver.openProject(name);
  }

  async then_project_is_present(name: string) {
    await this.driver.assertProjectPresent(name);
  }

  async then_project_deletion_is_not_available() {
    await this.driver.assertProjectDeletionUnavailable();
  }
}
```

- Each verb covers one domain concept. If a `when_` grows past a handful of driver calls, it's probably two scenarios.
- `given_*` verbs seed state (`patchState`, or a real-API seed call — see below). They perform no user actions.
- `when_*` verbs perform a user action. They never assert.
- `then_*` verbs assert. Most delegate to a `driver.assert*` method; a few that assert over queried data may call `expect` directly here. They never navigate or act.
- Keeping a small amount of scenario context on the DSL (the "current" project, a captured value) is fine and often cleaner than threading it through every call.

## The Driver

`Driver` is the contract between the DSL and the browser. It is a TypeScript interface (or abstract class) with **one method per domain capability** — not a bag of generic UI primitives. You won't find `clickButton` or `fillField` here; you'll find `defineProject`, `openProject`, `assertProjectDeletionUnavailable`. Writing the contract first forces you to name operations in domain terms before you touch a locator.

```typescript
// tests/dsl/Driver.ts
import type { Page } from "@playwright/test";

/** Test state the given_ verbs accumulate. Extend per your domain. */
export interface State {
  user?: UserInfo;
  projects?: Project[];
  assessments?: Assessment[];
}

/**
 * Driver — the contract every DSL verb calls through.
 *
 * There is normally ONE implementation, DriverUI, which drives the browser
 * with Playwright. Method names describe outcomes, never rendering:
 * "Available"/"Present"/"Absent", not "Visible"/"Shown"/"Open".
 */
export interface Driver {
  // ── State seeding ──────────────────────────────────────────────
  /** Merge partial state into the pending seed. Synchronous; accumulates. */
  patchState(state: Partial<State>): void;
  /** Apply the accumulated seed and open the app. Idempotent. */
  ensureInitialized(): Promise<void>;
  /** Undo anything the test created. Called from the fixture teardown. */
  cleanup(): Promise<void>;

  // ── Actions ────────────────────────────────────────────────────
  navigateToProjects(): Promise<void>;
  openCreateProject(): Promise<void>;
  defineProject(data: { name: string }): Promise<void>;
  saveProject(): Promise<void>;
  openProject(name: string): Promise<void>;

  // ── Assertions (outcome-named) ─────────────────────────────────
  assertProjectPresent(name: string): Promise<void>;
  assertProjectDeletionUnavailable(): Promise<void>;
}
```

The interface grows with the app: a new scenario that needs a new operation adds a method here first, then implements it in the Driver. Keeping it an explicit interface (rather than a lone class) documents the whole vocabulary in one file and lets you swap implementations if you ever want to — but you are not required to write more than one.

## DriverUI — the Playwright implementation

`DriverUI` is the only file that touches the Playwright API. Each method is a single focused UI operation; repeated locator patterns move into interaction helpers.

```typescript
// tests/dsl/DriverUI.ts
import { Page, expect } from "@playwright/test";
import { Driver, State } from "./Driver";
import { installMocks } from "./handlers";
import { navigate } from "./interactions/navigate";
import { findRow } from "./interactions/tableRow";

export class DriverUI implements Driver {
  private seed: Partial<State> = {};
  private started = false;

  constructor(private readonly page: Page) {}

  patchState(state: Partial<State>) {
    this.seed = { ...this.seed, ...state };
  }

  async ensureInitialized() {
    if (this.started) return;
    installMocks(this.page, this.seed); // MSW handlers seeded with test state
    await this.page.goto("/");
    this.started = true;
  }

  async cleanup() {
    // MSW + a fresh page per test means nothing to undo here.
  }

  async navigateToProjects() {
    await this.ensureInitialized();
    await navigate(this.page, "projects");
  }

  async openCreateProject() {
    await this.ensureInitialized();
    await this.page.getByTestId("create-project-button").click();
  }

  async defineProject(data: { name: string }) {
    await this.page.getByTestId("project-name-input").fill(data.name);
  }

  async saveProject() {
    await this.page.getByTestId("project-save-button").click();
  }

  async openProject(name: string) {
    await (await findRow(this.page, name)).click();
  }

  async assertProjectPresent(name: string) {
    await expect(this.page.getByTestId("project-row").filter({ hasText: name })).toBeVisible();
  }

  async assertProjectDeletionUnavailable() {
    await expect(this.page.getByTestId("project-delete-action")).toHaveCount(0);
  }
}
```

Note the outcome-named assertions call whatever Playwright primitive fits (`toBeVisible`, `toHaveCount(0)`, reading state) — the mechanics stay hidden behind the domain name.

## Setting up state: MSW mock or real backend

`given_` verbs need existing data to exist before the browser loads. There are two ways to make that happen. Pick one for your project; the specs don't care which.

### Option A — Mock the backend with MSW (fast, isolated)

Intercept the app's HTTP calls with [MSW](https://mswjs.io/) and serve them from an in-memory store seeded from `patchState`. No backend runs; tests are fast and hermetic.

```typescript
// tests/dsl/handlers.ts
import { http, HttpResponse } from "msw";
import type { Page } from "@playwright/test";
import type { State } from "./Driver";

// Build request handlers over a mutable store seeded from test state.
export function installMocks(page: Page, seed: Partial<State>) {
  const store = { projects: seed.projects ?? [], user: seed.user };

  const handlers = [
    http.get("/api/projects", () => HttpResponse.json(store.projects)),
    http.post("/api/projects", async ({ request }) => {
      const body = (await request.json()) as { name: string };
      const created = { id: crypto.randomUUID(), ...body };
      store.projects.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.get("/api/me", () => HttpResponse.json(store.user ?? null)),
    // …one handler per endpoint the flow touches
  ];

  // Wire handlers into the page. With @msw/playwright this is a network
  // fixture; in a plain setup, inject the worker in your app's test entry.
  return handlers;
}
```

With MSW, `given_` verbs are pure `patchState` calls (synchronous, no network), and `ensureInitialized()` installs the seeded handlers before the first navigation.

### Option B — Seed a real backend over its API (higher fidelity)

Point the app at a running backend and set up state by calling that backend's API in the `given_` verbs. Slower, needs a disposable/test database, but exercises the real server and real persistence.

```typescript
// tests/dsl/DriverUI.ts (real-backend seeding variant)
async ensureInitialized() {
  if (this.started) return;
  // Create seeded entities via the real API before the browser loads them.
  if (this.seed.user) await this.api.post("/api/test/login", this.seed.user);
  for (const p of this.seed.projects ?? []) await this.api.post("/api/projects", p);
  await this.page.goto("/");
  this.started = true;
}

async cleanup() {
  // Delete what this test created, so runs don't leak into each other.
  await this.api.delete("/api/test/state");
}
```

This usually needs a test-only affordance on the server: a seed/reset endpoint, or a login shortcut, active only when a `TEST_MODE` flag is set. A plain `fetch` wrapper is enough for the client — you don't need Playwright's `APIRequestContext`. `cleanup()` matters here (it's a no-op under MSW).

### Keeping both

If you want the same suite to run both ways, put just the seeding behind a small seam (`patchState` / `ensureInitialized` / `cleanup`) with an MSW implementation and an API implementation, and select via an env var in the fixture. The browser-driving methods stay in one place — you are not writing the whole Driver twice.

## Interaction helpers

Interaction helpers are plain functions (not classes) that wrap reusable UI patterns. They take `Page`, do one thing, and return a `Locator` when the caller needs to assert or `void` when they're a pure action. Collect them under `tests/dsl/interactions/`.

```typescript
// tests/dsl/interactions/navigate.ts
import { Page } from "@playwright/test";

export type Section = "projects" | "dashboard" | "settings";

const SECTION_URL: Record<Section, string> = {
  projects: "/projects",
  dashboard: "/dashboard",
  settings: "/settings",
};

export async function navigate(page: Page, section: Section) {
  await page.goto(SECTION_URL[section]);
  await page.waitForLoadState("networkidle");
}
```

```typescript
// tests/dsl/interactions/tableRow.ts
import { Page, Locator, expect } from "@playwright/test";

export async function findRow(page: Page, text: string): Promise<Locator> {
  const row = page.getByTestId("table-row").filter({ hasText: text });
  await expect(row).toBeVisible();
  return row;
}
```

- One file per UI pattern (row, combobox, dialog, date picker). Multi-step domain flows (e.g. "complete the whole survey") can live here too, as their own file.
- Keep each function tight and single-purpose; a few will legitimately be longer when the flow is.

## Selectors: `data-testid` first

`data-testid` is the default selector strategy — it's stable across copy changes and restyling, and it makes the Driver read cleanly.

- **Default:** `page.getByTestId("project-save-button")`, optionally narrowed with `.filter({ hasText })` or `.nth()`.
- **Use `getByRole` / `getByText`** when you're deliberately asserting user-facing semantics (accessibility roles, actual visible copy) and a testid would hide what you mean to check.
- **Never** couple to CSS classes or DOM structure — those change for reasons unrelated to behaviour.

Add the `data-testid` attributes to the app as you write the tests; treat them as a first-class part of the component contract.

## Test data generators

Generators are factory functions returning domain objects with sensible defaults. A test passes only the fields the scenario asserts on and lets the factory fill the rest.

```typescript
// tests/generators.ts
const id = () => "id-" + Math.random().toString(36).slice(2, 11);

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: id(),
    name: "Test Project",
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: id(),
    projectId: "",
    risk: "low",
    status: "approved", // default to the common case; override for drafts
    ...overrides,
  };
}
```

```typescript
await dsl.given([
  project({ id: "proj-1", name: "Alpha" }), // name matters: we assert it's present
  project({ id: "proj-2", name: "Beta" }),  // second project to test filtering
]);
```

Give defaults real-world shape (a published assessment, an active project) so the common case needs no overrides and the overrides that appear signal what the scenario is actually about.

## Fixture setup — wiring the DSL

A Playwright fixture builds the DSL and injects it. `createDSL` returns a factory so each `beforeEach` gets a fresh instance, and teardown runs `cleanup()`.

```typescript
// tests/specs/playwright.setup.ts
import { test as base, expect } from "@playwright/test";
import { TestDSL } from "../dsl/TestDSL";
import { DriverUI } from "../dsl/DriverUI";
import type { Driver } from "../dsl/Driver";

type Fixtures = { createDSL: () => TestDSL };

export const test = base.extend<Fixtures>({
  createDSL: async ({ page }, use) => {
    const drivers: Driver[] = [];

    await use(() => {
      const driver = new DriverUI(page);
      drivers.push(driver);
      return new TestDSL(driver);
    });

    for (const driver of drivers) await driver.cleanup();
  },
});

export { expect };
```

If you support both seeding modes, select the seeder here from an env var (e.g. `TEST_BACKEND=msw|api`) and inject it into `DriverUI`.

## File layout

```text
tests/
  specs/
    playwright.setup.ts     ← fixtures; seeding-mode selection if any
    *.spec.ts               ← one file per feature area
  dsl/
    Driver.ts               ← the contract + State type
    DriverUI.ts             ← the Playwright implementation
    handlers.ts             ← MSW request handlers (MSW mode only)
    TestDSL.ts              ← given_ / when_ / then_ verbs
    interactions/
      navigate.ts
      tableRow.ts
      …                     ← one file per UI pattern
  generators.ts             ← test data factories
playwright.config.ts        ← timeouts, base URL, web server
```

## Refactoring an existing Playwright suite into this shape

You don't have to rewrite everything at once:

1. Add `playwright.setup.ts`, an empty `Driver` interface, and a `DriverUI` skeleton.
2. Take one existing test. Rewrite its title in business language and express its body as `given_` / `when_` / `then_` calls.
3. Move each raw Playwright line into a domain-named Driver method as you go — the interface grows one method per real need.
4. Pull recurring locator patterns into `interactions/` the second time you copy one.
5. Repeat per test. The old and new styles can coexist during the migration.

## Bootstrapping from scratch

1. Install: `npm install -D @playwright/test` then `npx playwright install chromium`. Add MSW (`npm install -D msw`) if you're mocking.
2. Minimal `playwright.config.ts`:

   ```typescript
   import { defineConfig } from "@playwright/test";
   export default defineConfig({
     testDir: "./tests/specs",
     use: { baseURL: "http://localhost:5173" },
     webServer: { command: "npm run dev", port: 5173 },
   });
   ```

3. Create the skeleton in order: `Driver.ts` (interface), `DriverUI.ts` (class), `TestDSL.ts`, `playwright.setup.ts`, `generators.ts`.
4. Write the first failing spec for one happy path. Implement only the Driver and DSL methods it needs, run it red, then make it green.
5. Choose your seeding mode: MSW to start (fastest), and add real-API seeding later behind the same `patchState`/`ensureInitialized` seam if you want server-level fidelity.

## Review checklist

A reviewer should read one `.spec.ts` and understand every scenario the feature covers without knowing Playwright, the component library, or the API. If they must open `DriverUI.ts` to learn what a test asserts, the DSL verb is too low-level.

- [ ] Title reads as product behaviour, in business language, with no page/button/dialog and no `"Scenario:"` prefix.
- [ ] `given_` / `when_` / `then_` separation is clean: no action in `given_`, no setup in `when_`, no assertion in `when_`.
- [ ] Verb and Driver-method names describe outcomes (`Available` / `Present` / `Absent`), not rendering (`Visible` / `Shown` / `Open`).
- [ ] Driver methods are domain operations, not generic UI primitives leaking into the DSL.
- [ ] Generators supply seed data; no inline literals stuffed with irrelevant fields.
- [ ] Every interaction with the page goes through the Driver, never the spec.
- [ ] Selectors use `data-testid` by default; `getByRole` / `getByText` only for genuine semantic/copy assertions; never CSS.
