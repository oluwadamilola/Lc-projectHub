# LC ProjectHub server

Express + TypeScript API. All data is held **in memory** and is **fictional**.

## Demonstration data resets on every restart

Nothing is stored on disk or in a database. Every time the server starts it rebuilds its data from the original
fictional seed (`src/data/seed*.ts`). Anything created through the API while it was running (projects, tasks,
inspections, equipment found during an inspection) is **lost when the server stops or restarts**. This is deliberate
for the demonstration build: a restart returns the application to its known starting state (for the Audit module,
Summer 2025 and 2026 closed, Summer 2027 open with no inspections).

## Audit: carrying out an inspection (Stage 2a)

All under `/api/audit`. Errors use the usual body `{ "error": { "code", "message", "details?" } }`:
`400 VALIDATION_ERROR` (bad input, or a checklist that cannot be completed yet; `details` names each field),
`404 NOT_FOUND` (unknown reference), `409 CONFLICT` (the request is valid but clashes with the current state).

| Method and path | What it does |
|---|---|
| `POST /rooms/:roomId/inspection` | Starts an inspection in the open cycle, body `{ "inspectorId": "TECH-001", "cycleId?": "CYC-003" }`. **Idempotent:** if the room already has an inspection in progress in that cycle it is returned (200) and nothing is created; `201` only when a new record is made. A room that was **unable to inspect** is picked up again by the same record (attempt history kept). 409 if the room is already completed, outside the cycle's scope, or the cycle is closed or there is no open cycle. |
| `GET /inspections/:id` | The inspection: room, checklist (each line with this inspection's answer and last time's), progress (`checked` of `total`), whether it can be completed and what is still missing (`completion`), the attempts, and, once completed, the `summary`. |
| `PUT /inspections/:id/results/:itemId` | Saves one line: `{ "condition", "note", "checks?" }`. Conditions: Working, Not working, Needs replacement, Missing, Not applicable, or Not checked to clear it. Replaces the whole line; any check not sent becomes Not checked. A note that is required but not yet written is accepted here (so the inspector can type it after choosing), but completion insists on it. |
| `POST /inspections/:id/equipment` | Adds equipment found in the room: `{ "equipmentTypeId", "name?", "assetTag?", "serialNumber?" }`. It is added to the equipment inventory **and** this checklist together, flagged **Needs review**. 409 if the asset tag is already used by an active item. Withdraws any "no equipment" confirmation. |
| `PUT /inspections/:id/no-equipment` | `{ "confirmed": true }` says the room has no equipment (**409 if it has active equipment**); `false` takes it back. |
| `POST /inspections/:id/unable` | Records that the room could not be inspected: `{ "reason" (3 to 300 characters), "inspectorId?" }`. Stores the reason, who recorded it and when. **Answers already saved and equipment found are kept.** The room can be started again, which resumes the same record (attempt history and answers kept; new lines are added only for equipment that joined the room meanwhile). |
| `POST /inspections/:id/complete` | Completes the inspection after checking, on the server, every line: all items answered, a note for Not working / Needs replacement / Missing, every firmware check answered (a failed one needs a note), the "no equipment" confirmation for an empty room, and a line for every active item. 400 lists every problem. Returns the inspection with its `summary` (counts by condition, issues reported, failed checks, equipment needing review). |

A completed inspection can never be changed: every write to it is `409`. Completing twice (or two requests at the
same moment) completes once; the others get `409`. The pages that already exist read the same data, so a room's page
and the cycle progress reflect an inspection as soon as it is saved.

Not part of Stage 2a: the issue-management system (issues beyond the completion summary), corrections to completed
inspections, closing a cycle, and any change to the inventory other than adding equipment found.

### How changes stay safe

- Every write runs **one at a time** inside `InspectionService`, in the order requests arrive. In this single-process
  in-memory build that is what makes "start" idempotent and "complete" safe against double submission. A database
  version would get the same from a transaction (the repository `save` already replaces a whole inspection, with all
  its lines, as one change).
- Adding found equipment creates the inventory entry first, then saves the checklist; if the save fails the entry is
  removed again, so an item is never left without its line.
- Timestamps come from an injectable clock (the real clock by default). **Cycle dates are enforced** with the same
  clock: an inspection can be started, changed or completed only from the cycle's start date to its end date,
  inclusive; outside that window the request is `409` and the message names the date. Reading is never blocked.
- **Demonstrating outside the window:** the seeded open cycle (Summer 2027) starts 2027-06-21, so with the real
  date before then every write is refused. Start the server with `AUDIT_CLOCK_NOW` set to a date inside the window
  (for example `AUDIT_CLOCK_NOW=2027-07-12T09:00:00Z`) and the audit clock starts there and then runs at normal
  speed. The browser test stack does this for its isolated server only.
