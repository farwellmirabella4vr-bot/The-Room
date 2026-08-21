# Spec: Hello World API Endpoint

## Feature Request
Add a hello world API endpoint.

## Overview
Establish a minimal Node.js/Express HTTP API in this repo (currently empty of application code) with a single `GET /api/hello` endpoint that returns a static JSON greeting. This also lays down the baseline project scaffolding (package.json, entrypoint, route structure) that future endpoints can build on.

## Codebase Context
The repository currently contains no application source code — only the `.pipeline/` pipeline-state files, `.claude/` agent configs, and git metadata. There is no existing `package.json`, `src/` directory, backend framework, or test framework anywhere in the repo (verified via full-tree glob). Because there is no existing convention to follow, this spec chooses a minimal, widely-used, sensible stack:

- **Runtime/Language:** Node.js, CommonJS modules (`require`/`module.exports`) — no build step, no TypeScript, to keep this truly minimal.
- **Framework:** Express 4.x — the de facto standard minimal HTTP framework for Node, well suited to a single-route "hello world" API and easy for the tester to exercise with Supertest.
- **Test framework (for the tester stage):** Jest + Supertest. These must be added as devDependencies by the coder so the tester can immediately write and run tests without introducing its own tooling choice.

## Files to Create/Modify

- `package.json` — **create**. Defines the project, `express` as a dependency, `jest`/`supertest` as devDependencies, and `start`/`test` scripts.
- `src/app.js` — **create**. Builds and configures the Express `app` (sets routing options, mounts the router) and exports it *without* calling `.listen()`, so it can be imported directly by Supertest in tests without binding a real port.
- `src/server.js` — **create**. Entry point for running the app as a real server: imports `app` from `src/app.js` and calls `app.listen()` on a configurable port. This file is the one referenced by `npm start` / `package.json`'s `main`.
- `src/routes/hello.js` — **create**. An Express `Router` exposing the `GET /hello` route handler (mounted under `/api` in `app.js`, producing the full path `/api/hello`).

After creating `package.json`, the coder must run `npm install` (via Bash) so `node_modules` exists and `npm test` is runnable by the tester in the next stage.

## Function/Type Signatures

### `src/routes/hello.js`
```js
// CommonJS module. Exports an Express Router instance.
const express = require('express');
const router = express.Router();

// GET /hello (mounted at /api -> full path /api/hello)
// Handler signature: (req: express.Request, res: express.Response) => void
router.get('/hello', (req, res) => {
  res.status(200).json({ message: 'Hello, World!' });
});

module.exports = router; // type: express.Router
```

### `src/app.js`
```js
// CommonJS module. Exports a configured Express application (not listening).
const express = require('express');
const helloRouter = require('./routes/hello');

const app = express(); // type: express.Express

app.set('case sensitive routing', true);
// 'strict routing' left at Express default (false), so trailing slashes
// on registered paths are treated as equivalent (see Edge Cases).

app.use('/api', helloRouter);

module.exports = app; // type: express.Express
```

### `src/server.js`
```js
// CommonJS module. Entry point; not imported by tests.
const app = require('./app');

const PORT = process.env.PORT || 3000; // type: number (coerced from env string)

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

### `package.json` (key fields)
```json
{
  "name": "dev-team-hello-api",
  "version": "1.0.0",
  "private": true,
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

## Request/Response Contract

**Request:** `GET /api/hello`
- No path params, no required query params, no required request body or headers.
- Any request body, query string, or `Accept` header present on the request is ignored; the response is always the same static payload.

**Success Response:** `200 OK`
- `Content-Type: application/json; charset=utf-8`
- Body (exact JSON, key and value must match verbatim):
```json
{ "message": "Hello, World!" }
```

**Unmatched route/method:** Express's default 404 handler applies (no custom 404 middleware is added by this spec) — `404 Not Found`, `Content-Type: text/html; charset=utf-8`, body containing `Cannot <METHOD> <path>`.

## Edge Cases

The tester must cover all of the following, using `src/app.js` (the exported, non-listening app) with Supertest:

1. **Happy path** — `GET /api/hello` → `200`, `Content-Type` starts with `application/json`, body deep-equals `{ "message": "Hello, World!" }` exactly (no extra keys, exact casing/punctuation).
2. **Wrong method, same path** — `POST /api/hello`, `PUT /api/hello`, `DELETE /api/hello`, `PATCH /api/hello` → each returns `404` (Express default "Cannot <METHOD> /api/hello" handler; no route registered for these verbs on this path).
3. **HEAD on the route** — `HEAD /api/hello` → `200` with the same headers as GET (`Content-Type: application/json...`) but an empty body (Express auto-derives HEAD from the GET handler).
4. **OPTIONS on the route** — `OPTIONS /api/hello` → `200` with an `Allow` header listing `GET,HEAD` (Express's automatic OPTIONS handling for a path with a registered route), empty body.
5. **Wrong path (sibling/near-miss)** — `GET /api/hell`, `GET /api/hello-world`, `GET /hello` (missing `/api` prefix), `GET /api/hello/extra` (extra segment) → each `404`.
6. **Root path** — `GET /` → `404` (no route registered at root).
7. **Trailing slash** — `GET /api/hello/` → `200` with the same body as the happy path (Express's default non-strict routing treats `/api/hello` and `/api/hello/` as equivalent since `strict routing` is not enabled).
8. **Case sensitivity** — `GET /API/hello` and `GET /api/Hello` → each `404` (because `app.set('case sensitive routing', true)` is explicitly configured in `src/app.js`).
9. **Extraneous query string** — `GET /api/hello?name=Trey&foo=bar` → `200`, body unchanged (`{ "message": "Hello, World!" }`) — query params are accepted but ignored, not interpolated into the message.
10. **Request body present on GET** — `GET /api/hello` with a JSON body attached → `200`, body unchanged; the body is ignored (no `express.json()` body parsing is wired up for this route, and none is required since the handler never reads `req.body`).
11. **Unusual `Accept` header** — `GET /api/hello` with `Accept: text/plain` or `Accept: */*` → still `200` with `Content-Type: application/json...` (no content negotiation is implemented; the response format never varies).
12. **Concurrent/repeated requests** — issuing multiple `GET /api/hello` requests back-to-back (e.g., in a `Promise.all`) → each independently returns `200` with the identical static body (handler is stateless, no shared mutable state).
13. **Content-Type correctness** — explicitly assert the response `Content-Type` header value (not just that the body parses as JSON), to catch a handler that returns `res.send()`/text instead of `res.json()`.

## Out of Scope

- Any endpoint other than `GET /api/hello` (no additional CRUD routes, no health-check endpoint, etc.).
- Dynamic/personalized greetings (e.g., `?name=` interpolation) — the message is always the static string `"Hello, World!"`.
- Authentication, rate limiting, CORS configuration, request logging middleware, or HTTPS/TLS setup.
- A custom 404/error-handling middleware — Express's built-in default 404 behavior is used as-is (see "Unmatched route/method" above).
- Containerization, CI/CD config, linting config, or TypeScript migration.
- Actually starting/binding the real server during tests — tests must import `src/app.js` directly (not `src/server.js`) and use Supertest, so no real port is bound and no `PORT`-in-use conflicts can occur during the test run.
- Persisting or logging request data.

## Open Questions / Assumptions

- **Tech stack choice:** The repo had zero existing application code or dependencies, so there was no convention to match. Node.js + Express was chosen as the most common, minimal, low-ceremony choice for a single "hello world" HTTP endpoint. If the team intended a different language/framework (e.g., Python/Flask, Go), this spec's file layout does not apply and the coder should flag that in `changes.md` rather than silently switching stacks.
- **Route path:** Chose `/api/hello` (rather than bare `/hello`) to leave room for future endpoints under an `/api` prefix, which is a common convention. This is an assumption since the feature request did not specify a path.
- **HTTP method:** `GET` was chosen since retrieving a static greeting is a read-only, idempotent operation — the natural fit for `GET`.
- **Response shape:** Chose `{ "message": "Hello, World!" }` (JSON object with a `message` key) over a bare string or `{"hello": "world"}` because it's the most common convention for a "hello world" JSON API and is easy to extend later. No existing convention existed in the repo to override this choice.
- **Case-sensitive routing:** Explicitly enabled (`app.set('case sensitive routing', true)`) to make routing behavior deterministic and testable rather than relying on Express's default case-insensitive matching, which could otherwise surprise the tester.
- **Test file location:** Not fixed in this spec (no existing test directory convention exists in the repo). The tester should place the Supertest/Jest test file at `test/hello.test.js` (creating the `test/` directory) unless it discovers a different convention was introduced by the coder — this is a suggestion, not a hard requirement, since test file placement is the tester's call per the pipeline process.
