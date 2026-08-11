# Playwright acceptance testing conventions

Patterns for end-to-end acceptance tests that double as readable specs: domain vocabulary in the test file, a DSL that translates intent into browser actions, and a Driver that knows how to execute it. Works with or without an existing test suite.

## The core idea

Acceptance tests have two jobs: prove a feature works, and document what it should do. The DSL pattern keeps these in the same file. A spec describes behaviour in domain language; a Driver knows how to perform that behaviour against the real UI. You write the same test regardless of whether you drive through a browser or through an API. Only the Driver changes.

```text
spec (.spec.ts)
  └─ TestDSL          ← speaks the domain (given / when / then)
       └─ Driver       ← interface (abstract contract)
            ├─ DriverUI    ← Playwright + optional API mock
            └─ DriverAPI   ← HTTP client (for integration runs)
```

This separation means:

- Specs are stable; only the Driver changes when the UI changes.
- The same spec can run in fast isolated mode (mocked backend) or against a real server.
- New contributors read one spec and understand the feature; they don't need to know Playwright.

## Writing a spec

Each test is a user story in past-tense, third-person prose: the test name says what happened, not what the code does. Use `given_`, `when_`, `then_` prefixes in the DSL to make setup, action, and assertion visually distinct.

```typescript
// tests/specs/project-management.spec.ts
import { test } from "./playwright.setup";
import { TestDSL } from "../dsl/TestDSL";
import { project } from "../generators";

let dsl: TestDSL;

test.beforeEach(async ({ createDSL }) => {
  dsl = createDSL();
});

test("Scenario: Admin creates a project", async () => {
  await dsl.given_admin_user();

  await dsl.when_user_creates_project({ name: "Alpha" });

  await dsl.then_project_is_visible("Alpha");
});

test("Scenario: Respondent cannot delete a project", async () => {
  await dsl.given_respondent_user();
  await dsl.given([project({ name: "Alpha" })]);

  await dsl.when_user_opens_project("Alpha");

  await dsl.then_delete_action_is_not_available();
});
```

- One scenario per `test()`. The name starts with "Scenario:" and reads as prose.
- `given_*` is a pre-condition. Seed state the test needs. Never use a `when_` step to set up state.
- `when_*` is the action under test. Prefer a single `when_` per scenario.
- `then_*` is the observable outcome. Assert exactly what the scenario claims.
- Keep `given([...])` short. Pass factory-built objects, not inline literals.

## The DSL class

`TestDSL` is a thin orchestration layer that holds a `Driver` reference and exposes domain-named methods. It never contains raw Playwright calls.

```typescript
// tests/dsl/TestDSL.ts
import { Driver } from "./Driver";

export class TestDSL {
  constructor(private readonly driver: Driver) {}

  async given_admin_user(user?: UserInfo) {
    await this.driver.login(user ?? DEFAULT_ADMIN);
  }

  async given_respondent_user(user?: UserInfo) {
    await this.driver.login(user ?? DEFAULT_RESPONDENT);
  }

  async given(items: SeedItem[]) {
    await this.driver.seed(items);
  }

  async when_user_creates_project(data: { name: string }) {
    await this.driver.navigate_to("projects");
    await this.driver.click_create();
    await this.driver.fill_field("name", data.name);
    await this.driver.submit_form();
  }

  async when_user_opens_project(name: string) {
    await this.driver.navigate_to("projects");
    await this.driver.click_row_with(name);
  }

  async then_project_is_visible(name: string) {
    await this.driver.assert_text_visible(name);
  }

  async then_delete_action_is_not_available() {
    await this.driver.assert_action_absent("Delete");
  }
}
```

- Each method covers one domain concept. Split when a method grows past ~5 `driver` calls.
- `given_` methods call `driver.seed()` or `driver.login()`, nothing else.
- `when_` methods call `driver.navigate_to()` then one user action. They never call `then_` assertions.
- `then_` methods call `driver.assert_*`. No navigation, no actions.
- The DSL has no `Page` reference. Playwright never appears here.

## The Driver interface

`Driver` is a TypeScript interface (or abstract class) that defines every operation a spec can perform. It has no implementation, only the contract. Writing this contract first forces you to name things in domain terms before touching the browser.

```typescript
// tests/dsl/Driver.ts
export interface Driver {
  // lifecycle
  login(user: UserInfo): Promise<void>;
  logout(): Promise<void>;
  cleanup(): Promise<void>;

  // state seeding (bypasses the UI for speed)
  seed(items: SeedItem[]): Promise<void>;

  // navigation
  navigate_to(section: AppSection): Promise<void>;

  // generic UI primitives (keep these minimal)
  click_create(): Promise<void>;
  click_row_with(label: string): Promise<void>;
  fill_field(field: string, value: string): Promise<void>;
  submit_form(): Promise<void>;

  // assertions
  assert_text_visible(text: string): Promise<void>;
  assert_action_absent(label: string): Promise<void>;
}

// Shared types
export type AppSection = "projects" | "dashboard" | "settings";
export type SeedItem = Project | Survey | Assessment; // your domain types
export interface UserInfo { email: string; password: string; }
```

The interface grows with the app. Every new spec that needs a new operation extends this interface first, then both Driver implementations.

## DriverUI — the Playwright implementation

`DriverUI` implements `Driver` using Playwright's `Page`. It is the only file that contains Playwright API calls. Keep each method focused on a single UI operation; delegate repeated patterns to interaction helpers.

```typescript
// tests/dsl/DriverUI.ts
import { Page } from "@playwright/test";
import { Driver, AppSection, SeedItem, UserInfo } from "./Driver";
import { navigate } from "./interactions/navigate";
import { findTableRow } from "./interactions/tableRow";

export class DriverUI implements Driver {
  constructor(private readonly page: Page) {}

  async login(user: UserInfo) {
    await this.page.goto("/login");
    await this.page.getByLabel("Email").fill(user.email);
    await this.page.getByLabel("Password").fill(user.password);
    await this.page.getByRole("button", { name: "Sign in" }).click();
    await this.page.waitForURL("/dashboard");
  }

  async logout() {
    await this.page.getByRole("button", { name: "Sign out" }).click();
  }

  async cleanup() {
    // nothing — MSW resets per test; override in DriverAPI
  }

  async seed(items: SeedItem[]) {
    // In UI mode: push items into the MSW in-memory store.
    // Call a test-only window function or use page.evaluate():
    for (const item of items) {
      await this.page.evaluate(
        ([i]) => (window as any).__testSeed?.(i),
        [item] as const,
      );
    }
  }

  async navigate_to(section: AppSection) {
    await navigate(this.page, section);
  }

  async click_create() {
    await this.page.getByRole("button", { name: /create|add/i }).click();
  }

  async click_row_with(label: string) {
    const row = await findTableRow(this.page, label);
    await row.click();
  }

  async fill_field(field: string, value: string) {
    await this.page.getByLabel(field, { exact: false }).fill(value);
  }

  async submit_form() {
    await this.page.getByRole("button", { name: /save|submit|confirm/i }).click();
  }

  async assert_text_visible(text: string) {
    await expect(this.page.getByText(text)).toBeVisible();
  }

  async assert_action_absent(label: string) {
    await expect(this.page.getByRole("button", { name: label })).not.toBeVisible();
  }
}
```

## DriverAPI — the HTTP implementation (optional second mode)

`DriverAPI` implements the same interface but calls the backend directly over HTTP. This mode skips the browser for setup/teardown and can verify the API contract alongside the UI tests.

```typescript
// tests/dsl/DriverAPI.ts
import { request, APIRequestContext } from "@playwright/test";
import { Driver, AppSection, SeedItem, UserInfo } from "./Driver";

export class DriverAPI implements Driver {
  private ctx!: APIRequestContext;

  constructor(private readonly baseURL: string) {}

  async login(user: UserInfo) {
    this.ctx = await request.newContext({ baseURL: this.baseURL });
    await this.ctx.post("/api/auth/login", { data: user });
  }

  async cleanup() {
    await this.ctx.delete("/api/test/state");
    await this.ctx.dispose();
  }

  async seed(items: SeedItem[]) {
    await this.ctx.post("/api/test/seed", { data: { items } });
  }

  async navigate_to(_section: AppSection) {
    // No-op — no browser in API mode
  }

  // ...rest mirrors the interface; each method calls a real endpoint
}
```

The API driver requires a test-only seed endpoint on the server (protected, only active when `TEST_MODE=true`). If you don't have one, start with DriverUI only.

## Interaction helpers

Interaction helpers are plain functions (not classes) that encapsulate reusable UI patterns. They take `Page` and return a value or perform an action. Collect them in `tests/dsl/interactions/`.

```typescript
// tests/dsl/interactions/navigate.ts
import { Page } from "@playwright/test";
import { AppSection } from "../Driver";

const SECTION_URL: Record<AppSection, string> = {
  projects: "/projects",
  dashboard: "/dashboard",
  settings: "/settings",
};

export async function navigate(page: Page, section: AppSection) {
  await page.goto(SECTION_URL[section]);
  await page.waitForLoadState("networkidle");
}
```

```typescript
// tests/dsl/interactions/tableRow.ts
import { Page, Locator } from "@playwright/test";

export async function findTableRow(page: Page, text: string): Promise<Locator> {
  const row = page.locator("tr", { hasText: text });
  await expect(row).toBeVisible();
  return row;
}
```

```typescript
// tests/dsl/interactions/combobox.ts
import { Page } from "@playwright/test";

// Combobox pattern — type to search, click to select
export async function selectCombobox(page: Page, label: string, value: string) {
  await page.getByLabel(label).click();
  await page.getByPlaceholder("Search…").fill(value);
  await page.getByRole("option", { name: value }).click();
}
```

- One file per UI component pattern (combobox, dialog, table row, date picker).
- Each function does one thing and stays under ~15 lines.
- Use `data-testid` attributes.
- Return `Locator` when the caller needs to assert; return `void` when the function is a pure action.

## Test data generators

Generators are factory functions that return domain objects with sensible defaults. Tests pass only the fields that matter to the scenario and leave the rest to the factory.

```typescript
// tests/generators.ts
import { v4 as uuid } from "uuid";

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: uuid(),
    name: "Test Project",
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: uuid(),
    projectId: "",
    score: 80,
    riskLevel: "low",
    ...overrides,
  };
}
```

Usage in tests: always pass the fields the scenario asserts on; let the rest be defaults.

```typescript
await dsl.given([
  project({ id: "proj-1", name: "Alpha" }),   // name matters: we assert it's visible
  project({ id: "proj-2", name: "Beta" }),    // second project to test filtering
]);
```

## Fixture setup — wiring the DSL

Use Playwright fixtures to create the DSL and inject it into every test.

```typescript
// tests/specs/playwright.setup.ts
import { test as base, expect } from "@playwright/test";
import { TestDSL } from "../dsl/TestDSL";
import { DriverUI } from "../dsl/DriverUI";
import { DriverAPI } from "../dsl/DriverAPI";
import { Driver } from "../dsl/Driver";

type Fixtures = { createDSL: () => TestDSL };

export const test = base.extend<Fixtures>({
  createDSL: async ({ page }, use) => {
    const mode = process.env.TEST_MODE ?? "ui";
    let driver: Driver;

    if (mode === "api") {
      driver = new DriverAPI(process.env.API_BASE_URL ?? "http://localhost:8000");
    } else {
      driver = new DriverUI(page);
    }

    await use(() => new TestDSL(driver));

    await driver.cleanup();
  },
});

export { expect };
```

## File layout

```text
tests/
  specs/
    playwright.setup.ts     ← custom fixtures, driver selection
    *.spec.ts               ← one file per feature area
  dsl/
    Driver.ts               ← interface (the contract)
    DriverUI.ts             ← Playwright implementation
    DriverAPI.ts            ← HTTP implementation (optional)
    TestDSL.ts              ← domain-named given/when/then methods
    interactions/
      navigate.ts
      tableRow.ts
      combobox.ts
      dialog.ts
      …                     ← one file per UI component pattern
  generators.ts             ← test data factories
playwright.config.ts        ← timeouts, base URL, web server
```

## Bootstrapping from scratch

If the project has no test setup:

1. **Install dependencies**:

   ```bash
   npm install -D @playwright/test
   npx playwright install chromium
   ```

2. **`playwright.config.ts`** — minimal starting point:

   ```typescript
   import { defineConfig } from "@playwright/test";
   export default defineConfig({
     testDir: "./tests/specs",
     use: { baseURL: "http://localhost:5173" },
     webServer: { command: "npm run dev", port: 5173 },
   });
   ```

3. **Create the skeleton** in order: `Driver.ts` (empty interface), `DriverUI.ts` (empty class), `TestDSL.ts` (empty class), `playwright.setup.ts` (wiring), `generators.ts` (first factory).

4. **Write the first failing spec** for one happy-path scenario. Implement only the Driver and DSL methods it needs. Run it red, then implement the feature green.

5. **Add interaction helpers** the moment you copy the same Playwright locator pattern a second time.

6. **Add `DriverAPI`** only when you have a real backend and want integration coverage. Start with DriverUI only.

## Review checklist

A reviewer should be able to read one `.spec.ts` file and understand every user scenario the feature covers, without knowing Playwright, the component library, or how the API works. If they need to open `DriverUI.ts` to understand what a test asserts, the DSL method name is too low-level.

- [ ] Test name reads as a user story ("Scenario: Admin…")
- [ ] `given_`, `when_`, `then_` separation is clean: no action inside `given_`, no setup inside `when_`
- [ ] Generators are used for seed data; no inline object literals with irrelevant fields
- [ ] Every interaction with the page goes through DriverUI, not the spec directly
- [ ] Selectors use `data-testid` first, `getByRole` / `getByLabel` second, CSS never
