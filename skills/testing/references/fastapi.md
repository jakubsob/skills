# FastAPI testing conventions

Patterns for writing FastAPI tests. If the project already has a suite, match its existing fixtures and naming; the names below are illustrative, not prescriptive. If you're starting fresh, the "Bootstrapping from scratch" section builds the pieces these patterns assume.

## Test through the API, not the internals

Prefer to drive your code through its public HTTP interface: make a `TestClient` request and assert on the response, rather than calling internal functions, services, or repositories directly. The API is the contract you're building, and what your consumers actually depend on. Going through it exercises the whole stack the way it runs in production (routing, validation, serialization, auth, persistence), and it leaves you free to refactor internals without rewriting tests.

Unit-test internals only for critical or hard logic the API can't cover exhaustively: a tricky algorithm, an edge-case-heavy pure function, a security-sensitive helper. These are the exception, not the default. If you think a case warrants one, ask first instead of adding it automatically.

## The stack

- pytest with pytest-asyncio for async tests. If asyncio mode isn't set to auto in config, each async test needs an explicit `@pytest.mark.asyncio`.
- FastAPI's `TestClient` (sync, httpx under the hood) drives endpoints. For fully async end-to-end tests, `httpx.AsyncClient` with an ASGI transport is the alternative.
- Run real instances of the infrastructure you control. For a backing service you can run yourself (a database, Redis, a message broker), use Testcontainers to start the same engine and major version the app uses in production, rather than mocks or a stand-in like SQLite for Postgres. Start each container once per session and override the app's dependency onto it. Third-party services you can't run (external HTTP APIs, LLMs, payment providers) are handled differently. If the app has neither, skip this.
- Coverage (`pytest-cov`) on the application package, so new code is expected to be covered.

## Layout

```
tests/
  conftest.py               # shared fixtures
  helpers.py                # small test utilities
  test_api_<resource>.py    # one file per API resource
```

- **One test file per resource**, named to mirror the route module it covers.
- Group an endpoint's tests in a `class Test<Resource>`.
- Keep the test-function prefix consistent (`test_*`) and enforce it in config.

## Core fixtures

Whatever the project calls them, you generally want fixtures covering these roles. The state-setup ones depend on the backing service (a database wants row insertion, Redis wants key seeding, a queue wants enqueued messages), but they share one shape: seed the precondition, then clean up on teardown.

| Role          | Scope    | Use it for                                                                                                                                                                     |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| test client   | function | A `TestClient` with external dependencies overridden onto their test instances. Calls endpoints.                                                                               |
| state setup   | function | Seed a real backing service as a precondition (DB rows, Redis keys, …); clean up on teardown, do it via direct interaction with the service, not via the API-under-test calls. |
| direct handle | function | A session/client for asserting against a backing service directly, outside the API.                                                                                            |
| async session | function | Async sessions for exercising async code or features.                                                                                                                          |

If the app needs per-test isolation (auth bypasses, scheduler state, caches), express it as autouse fixtures that reset that state for every test, rather than relying on each test to remember.

## Setting up DB state with real rows

A database is the most common backing service, so it gets the worked example here; other real services (Redis, a broker) follow the same seed-then-clean-up shape.

Set up preconditions by inserting real data, not by mocking data-access functions. Build (or reuse) a fixture that truncates the target table, inserts your rows, commits, and cleans up on teardown, cascading the cleanup in reverse order so foreign keys don't block it. An illustrative shape:

```python
insert_rows(table="study", rows=[...])                  # default schema
insert_rows(table="user", schema="auth", rows=[...])    # specify schema when needed
```

Pass the schema explicitly when the table isn't in the default one.

### Deterministic IDs and row factories

- For readable, exactly-assertable IDs, write a small helper that turns a small integer into a stable UUID (e.g. `uuid(1)` → `00000000-0000-0000-0000-000000000001`). Small integers keep IDs legible and let assertions compare exact values.
- Add factory helpers that return plain dicts with sensible defaults, taking only the required fields positionally and the rest as keyword overrides. Prefer these over hand-writing full row dicts in every test.
- For data specific to one test file, define a local `@pytest.fixture` returning the rows.

## Endpoint test template

```python
import pytest
from helpers import uuid


class TestResource:
    """Tests for GET /<resource> endpoint."""

    def test_returns_all_items(self, test_client, insert_rows):
        # Arrange
        sample_data = [
            {"id": str(uuid(1)), "name": "...", ...},
            ...
        ]
        insert_rows(table="<resource>", rows=sample_data)

        # Act
        response = test_client.get("/<resource>")

        # Assert
        assert response.status_code == 200
        assert response.json() == [
            {"id": str(uuid(1)), "name": "...", ...},
            ...
        ]

    def test_returns_empty_list_when_none(self, test_client):
        # Act
        response = test_client.get("/<resource>")

        # Assert
        assert response.status_code == 200
        assert response.json() == []
```

Conventions shown:

- Explicit `# Arrange` / `# Act` / `# Assert`.
- Assert the **status code** and the fields that matter in given test.
- Always include the empty / zero-rows case.
- A test that needs no data simply omits the row-insertion fixture, but keeps empty `# Arrange` section.

## Auth & dependency overrides

FastAPI resolves the current user through a dependency (`get_current_user` or similar), no matter where identity actually comes from: a local users table, a signed JWT, or an external provider like OAuth/OIDC, Auth0, or Cognito. In tests, don't drive the real provider. Override that dependency to return a fixed test identity. This works for every auth backend, because you're replacing the seam the routes depend on, not the provider behind it. Do it in a fixture that yields the client, then pop the override on teardown.

```python
from app.main import app
from app.<auth_module> import get_current_user

MOCK_USER = ...  # build the project's user/context type


@pytest.fixture
def authed_client(test_client):
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    yield test_client
    app.dependency_overrides.pop(get_current_user, None)
```

- If the app _also_ checks that identity against a backing service (a user row for DB-level authorization or row-level security), seed that record in the same fixture so the override and the stored data line up. If auth is purely token/provider-based with no local record, the override alone is enough.
- One fixture per role when testing authorization tiers.
- Always pop the override in teardown so it doesn't leak into other tests.
- Test the authorization matrix with `parametrize` over `(method, path)`:

```python
@pytest.mark.parametrize("method,path", [
    ("POST", "/<resource>/search"),
    ("GET",  "/<resource>/<id>"),
])
def test_endpoints_return_403_without_role(unauthorized_client, method, path):
    # Act
    response = unauthorized_client.request(method, path, json={})
    # Assert
    assert response.status_code == 403
```

## Mocking, only at the boundary

Use the real backing service for everything it can do. Reach for `unittest.mock` only at genuine external boundaries: an LLM/agent call, outbound HTTP, a third-party API. When you do, build a small payload helper and a result builder rather than scattering `MagicMock()` through each test. Patch async call sites with `AsyncMock`/`patch`.

## Async tests

For tests that drive async code directly (not through `TestClient`), mark them and use an async session:

```python
@pytest.mark.asyncio
async def test_something(async_session_factory):
    async with async_session_factory() as session:
        ...
```

`TestClient` itself is sync, so most endpoint tests are plain `def`, and the dependency override bridges to the async DB layer for you.

## Bootstrapping from scratch (no suite yet)

If a project has none of this, build it in this order so the patterns above work:

1. **Deps**: `pytest`, `pytest-asyncio`, `pytest-cov`, `httpx`, plus `testcontainers` (with the relevant extra) if the app has a database. Add config (`pytest.ini` or `pyproject.toml`) with `testpaths` and the test-function prefix.
2. **`conftest.py`**: session-scoped fixtures for the container and engine; a schema-initialization fixture (migrations/DDL run once per session); a function-scoped test-client fixture that overrides the DB dependency onto the test engine and clears overrides on teardown; and a row-insertion fixture that truncates → inserts → cleans up on teardown.
3. **`helpers.py`**: small utilities such as the deterministic-ID helper.
4. **First test**: one `test_api_<resource>.py` with a `Test<Resource>` class, the happy path plus the empty case, asserting status code and exact body. Grow from there.

Keep new tests visually consistent with the templates above so the suite reads as one
style regardless of who (or what) wrote each test.
