# LC ProjectHub browser regression suite

Drives the **built** LC ProjectHub app in a real browser (Playwright) and checks what a person would see and do:
dashboard figures, projects, tasks (per project and across all projects), create and edit forms, the mobile menu, error and empty states, accessibility
basics and the light-only design. It currently contains **twelve suites and 855 checks**.

It is deliberately **isolated**. It never talks to the development server on port 4000, and it fails closed (refuses to
run) if it cannot prove that.

## How the isolation works

```
 browser ──► http://localhost:4173  (vite preview of the built client)
                 └─ /api ──► http://localhost:4001  (the built server, its own in-memory fictional seed data)
                      every response is stamped  x-test-stack: 1

 development server on :4000  ← never started, stopped or written to
```

1. `run-suite.mjs` starts the built server on **4001** and a `vite preview` on **4173** whose `/api` proxy points at 4001
   (`preview.test.config.mjs`; the application's own `client/vite.config.ts` is not touched).
2. Every suite starts with `assertIsolated()` (`lib/guard.mjs`). It refuses to run if the API or web address is port 4000,
   is not on this machine, or if `/api` on the web port is **not** stamped `x-test-stack: 1`.
3. Each suite runs on a **freshly restarted** test server, so suites cannot affect each other and counts are predictable.
4. If a development server happens to be running, its project count is only **read** before and after the run. The run
   fails if the count changed.
5. `npm run check` statically enforces the rules (no port 4000, no bare `route.continue()`, no hard-coded hosts, ports
   or machine paths, every suite calls the guard).

All data is fictional demonstration data held in memory; nothing is saved anywhere.

## Prerequisites

| Need | Why | How to satisfy it |
|---|---|---|
| Node 20 or newer | the runner uses `fetch` and `AbortSignal.timeout` | check `node -v` |
| Dependencies installed in the repo root | the built app and `vite` come from there | `npm install` in the repo root |
| Production builds | the stack serves `shared/dist`, `server/dist` and `client/dist` | `npm run build` in the repo root (rebuild after code changes; the runner warns about stale builds) |
| This folder's dependency | `playwright-core` (no browsers are downloaded) | `npm --prefix tests/browser install` |
| An installed browser | tests drive the real browser | Microsoft Edge (default), or `BROWSER_CHANNEL=chrome` for Google Chrome |
| Ports **4001** and **4173** free | the test server and the isolated preview | stop whatever uses them (a leftover run, for example) |

The runner checks every one of these before starting anything and prints what is wrong and how to fix it.

## Running

From the **repository root**:

```
npm --prefix tests/browser install     # once
npm run build                          # whenever the app code changed
npm run test:browser                   # all suites
```

Or from `tests/browser`:

```
npm test                               # all suites
node run-suite.mjs dash tasks          # only some suites
node run-suite.mjs --all --verbose     # stream each suite's output
npm run test:stack                     # start only the isolated stack, to look at it by hand (Ctrl+C stops it)
npm run check                          # static checks only (fast, no browser)
```

Exit code: `0` all passed and the dev server was untouched; `1` a suite failed (or the dev server changed);
`2` a prerequisite was missing or isolation could not be established (nothing was run).

Optional: `SHOTS=screenshots npm test` saves screenshots into `tests/browser/screenshots/` (git-ignored).

## The suites

| Suite | Checks | Covers |
|---|---|---|
| `dash` | 28 | "Tasks due this week" against an independent calculation; the five dashboard cards; loading, zero and failure states |
| `overdue` | 29 | "Overdue tasks" (yesterday, today, tomorrow, Done); shared task requests; failure and retry; layout |
| `alltasks` | 113 | the All tasks page: navigation, columns, every filter and search (against an independent calculation), URL state, paging, loading / empty / error / retry, overdue boundaries, agreement with the dashboard, phone layout |
| `audit-api` | 124 | the Audit module API (stage 1R-a read side, stage 2a write side), over real HTTP against the built server. First the read API: cycles (one open), progress per cycle, block and floor against an independent count, room lists by inspection state, equipment items and identifiers, checklist rules in the recorded inspections, previous answers, errors and the read-only contract, fictional-data guards; then, last, real inspections through the write API (start, idempotent restart, answer, notes, equipment found, no equipment, unable and retry (answers kept), complete, double submission, concurrency, closed cycles, invalid input). The Audit pages and their browser suite arrive in stage 1R-b |
| `audit` | 95 | the Audit pages (stage 1R-b), in a real browser against the seeded stack: sidebar entry, overview of the open cycle (Summer 2027, zero progress) and of closed cycles, switching cycle, block and floor navigation, room lists filtered by inspection state, the room checklist with this cycle's answers beside last time's (corrections, firmware wording, equipment needing review, rooms with no equipment, rooms that could not be inspected, retired rooms), failures and unknown addresses, read-only behaviour, small screens and accessibility. Every figure is checked against a count built independently from each room's own record |
| `inspect` | 99 | the technician's room inspection screens (stage 2b), in a real browser, every action through the real write API and every result read back from the server: getting to an inspection (start link, closed cycle, retired room), choosing the technician, recording several results with required notes and a firmware check, autosave feedback, reload and resume, completing with a summary, a completed inspection staying read-only; note, found-equipment and duplicate-asset-tag validation; failed saves, failed starts and completes and a failed load (network abort and a 500), with Try again; unable to inspect, then resuming the same inspection with the answers kept; a room with no equipment and its confirmation; double clicks and two screens on one inspection; tablet and phone layout, keyboard use and the light theme |
| `rowmenu` | 87 | the "⋮" actions menu on every task row (project page and All tasks): open, close, outside click, Escape, keyboard, one open at a time, not clipped (last row, short window, phone), touch sizes, colours and focus rings, row heights unchanged, light theme |
| `deletion` | 85 | deleting a task (project page and All tasks) and a project with all its tasks: confirmation, cancel, success message, failure and retry, double submission, already-deleted, no orphaned tasks, dashboard / All tasks counts, references never reused, light theme and small screens |
| `tasks` | 62 | task list, filters, paging; create and edit tasks; not-found states; phone layout; existing project features |
| `editing` | 53 | project create and edit: validation, double-submit guard, failures, unsaved-changes prompt, phone layout |
| `review` | 59 | light-only design, mobile menu and keyboard use, projects list on a phone, loading/empty/error/not-found, dashboard labels |
| `light-only` | 21 | the app stays light with a dark system setting; no theme switch; phone menu |

## Settings (environment variables)

`TEST_API_PORT` (default 4001), `TEST_WEB_PORT` (default 4173), `BROWSER_CHANNEL` (default `msedge`), `SHOTS`
(screenshot folder, off by default), `TEST_REPO` (only if this folder is moved out of the repository). Port 4000 is
refused everywhere, whatever the settings.

## Limitations

- **One browser, one platform tested.** Developed and verified with Microsoft Edge on Windows. Other browsers
  (`BROWSER_CHANNEL=chrome`) and other operating systems should work but are untested. Safari and Firefox are not covered.
- **Not a screen-reader test.** It checks roles, labels, focus and contrast programmatically; it does not replace testing
  with a screen reader or on a real phone.
- **Depends on the demo seed data.** Assertions name seeded records (for example `PRJ-101`, `TASK-021`, "12 projects",
  six technicians). If `server/src/data/seed*.ts` changes, update the suites to match.
- **Time-sensitive.** Figures such as "due this week" and "overdue" are checked against an independent calculation, but
  tasks are created dated yesterday, today and tomorrow, so a run that straddles local midnight can fail spuriously. Re-run it.
  The server generates its seed dates in UTC (`toISOString()` in `server/src/data/seedTasks.ts` and `seedProjects.ts`)
  while the browser uses local dates, so the seeded dates sit a day earlier than the local calendar between 00:00 and
  01:00 in UK summer time. Confirmed by reproduction; deliberately left unchanged because fixing it alters the seed
  data itself. The suites compute their expectations from the API's own data, so they only fail spuriously in that hour.
- **Suites need a fresh server.** Running a suite file directly twice without restarting the test server will give
  different counts the second time. Use the runner, which restarts the server before every suite.
- **Sequential.** The suites run one after another (about 35 seconds in total on the machine it was developed on, plus a few seconds of preflight).
- **Cleanup.** The runner stops everything it starts on normal completion, test failures, start-up errors, Ctrl+C and
  SIGTERM. Each child process also exits by itself when its connection to the runner closes (`lib/child-wrapper.mjs`), so
  even a hard kill of the runner (for example `taskkill /F` on Windows, which runs no handlers) does not leave test servers
  on ports 4001 and 4173; this was verified. Limits: the Ctrl+C and SIGTERM handlers could not be exercised automatically
  on Windows (the platform cannot deliver those signals programmatically); and a browser window opened by a suite at the
  moment of a hard kill is closed by the operating system a moment later, not instantly. If a port is ever still
  occupied, the next run's preflight says so and refuses to start.
- **Not wired into automated builds.** Nothing runs it automatically; run it before merging UI changes.

## Troubleshooting

| Message | Meaning |
|---|---|
| `REFUSING TO RUN: ... missing x-test-stack header` | The page is not going through the isolated stack. Start suites with the runner, not by hand. |
| `port 4001 ... is already in use` | Another process, often a leftover test server, holds the port. Stop it, or set `TEST_API_PORT`. |
| `no build found for: ...` | Run `npm run build` in the repository root. |
| `cannot launch the "msedge" browser` | Install Edge, or use `BROWSER_CHANNEL=chrome`. |
| `Development server ... CHANGED` | Something wrote to port 4000. Treat as a defect in the tests and investigate before trusting any result. |
