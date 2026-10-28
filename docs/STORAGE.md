# Demo Storage

## Approach

The demo uses a single JSON file at `data/demo-store.json` by default, implemented with Node's built-in `fs` module. No database, network service, or runtime dependency is used.

`src/store/leadStore.ts` defines the repository contract:

- Leads: `getLead`, `listLeads`, `saveLead`
- Tasks: `getTask`, `listTasks(leadId?)`, `saveTask`
- Outbox: `getOutboxMessage`, `listOutboxMessages(leadId?)`, `saveOutboxMessage`
- Activity log: `getActivityLogEntry`, `listActivityLog(leadId?)`, `saveActivityLogEntry`
- Bulk replace for seeding: `replaceAll`

`src/store/fileLeadStore.ts` is the implementation. Saves are upserts by `id`. Reads and writes return clones so callers cannot mutate stored records by reference.

## Seed and Reset

```powershell
npm run seed
npm run reset
```

Both commands restore the same known demo state. `reset` is an explicit alias for the same safe replacement operation.

Optional overrides:

```powershell
$env:HAIKA_STORE_PATH = "C:\temp\haika-demo.json"
$env:HAIKA_NOW = "2026-12-15T09:00:00.000Z"
npm run reset
```

- Default demo now: `2026-11-02T09:00:00.000Z` (`DEMO_NOW_ISO`).
- `HAIKA_NOW` pins the clock used to timestamp seed records and overdue tasks.
- `HAIKA_STORE_PATH` changes the store file. Only this file is written; unrelated project files are untouched.

The seed contains 15 fictional leads across every status and every supported source, including a partial lead, email-only and phone-only leads, a potential duplicate pair sharing a normalized phone number, won/lost leads, and tasks overdue relative to the default demo now.

## Clock

`src/lib/clock.ts` provides injectable clocks:

- `createFixedClock(value)` for a pinned demo.
- `createSystemClock()` for real time.
- `createManualClock(value)` with `set()` and `advanceBy()` for stepping the demo forward.

Repository operations do not read the clock. Seed and future automation receive a clock explicitly.

## Failure and Concurrency Semantics

- Missing file: the repository starts with an empty state. The file is created on the first write.
- Corrupted file or unsupported format: reads throw `StorageCorruptionError` with the path and reason. Running `npm run reset` replaces the bad file.
- Writes are atomic within one repository instance: the full state is written to a temporary file and renamed into place.
- Saves update the in-memory state immediately and persist serialized snapshots per repository instance.
- Concurrent-looking writes use last-write-wins semantics for the same record. Writes from separate processes to the same file are not locked; the last completed write wins.
- Reset replaces all four collections in the demo store. It does not delete other files or touch unrelated project data.
