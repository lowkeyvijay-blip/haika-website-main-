# Automation Notes

This document describes the automation and lead-intake behavior that exists in the repository today. It is written against the current code, not the intended full product. `README.md` and `IMPLEMENTATION_PLAN.md` describe the broader website/chatbot/dashboard vision; those experiences are not implemented yet.

## Architecture Overview

The current code is a framework-agnostic TypeScript service layer with a file-backed demo store. There is no website, chatbot UI, dashboard UI, HTTP API, server action, or background worker.

```text
future website form ─┐
future chatbot ──────┼─> createLeadIntake ──> validation / dedupe / qualification
                     │                              │
future dashboard ────┴─> createLeadActions ─────────┤
                                                    v
                                         applyAutomationRules
                                         markOverdueTasks
                                                    │
                                                    v
                                      LeadRepository (JSON file)
                                                    │
                                                    v
                                       data/demo-store.json
```

- `src/types/lead.ts` defines the lead, task, outbox, and activity records; phone/email normalization; validation; and the status-transition table.
- `src/automation/rules.ts` contains pure automation for lead creation, duplicate submissions, status changes, reassignment, and overdue escalation. It returns changes for the caller to persist.
- `src/automation/qualification.ts` contains the explicit, separately tested auto-qualification rule.
- `src/intake/leadIntake.ts` is the website/chatbot adapter. It validates submissions, deduplicates, updates partial leads, invokes automation, and persists the results.
- `src/actions/leadActions.ts` is the dashboard-facing service. It lists and reads leads, changes status, reassigns, completes tasks, adds notes, runs overdue checks, and builds summary counts.
- `src/store/fileLeadStore.ts` implements the repository with a single JSON file. `src/store/seed.ts` builds the deterministic demo state.
- `src/lib/clock.ts` provides fixed, system, and manually advanceable clocks.
- `src/store/seed-cli.ts` exposes seed/reset from the command line.

Both services should receive the same repository and clock when they are used together. Both also accept an optional `AutomationConfig`.

## Lead Record and Statuses

### Lead fields

A lead has:

- Identity and contact: `id`, `name`, `phone`, `email`, `preferredContactMethod`
- Project context: `projectType`, `propertyType`, `location`, `size`, `budgetRange`, `timeline`
- Acquisition and workflow: `source`, `status`, `owner`, `nextAction`
- Activity and notes: `lastActivity`, `notes`, `createdAt`, `updatedAt`

Supported sources are `website form`, `chatbot`, `campaign`, `referral`, and `instagram`.

Phone values are normalized by removing spaces, parentheses, dots, and hyphens; 7-15 digits are accepted with an optional leading `+`. Emails are trimmed and lowercased.

### Statuses and transitions

The seven statuses are:

`new`, `qualified`, `contacted`, `consultation booked`, `proposal`, `won`, `lost`

| From | Allowed next statuses |
| --- | --- |
| `new` | `qualified`, `contacted`, `lost` |
| `qualified` | `contacted`, `consultation booked`, `lost` |
| `contacted` | `consultation booked`, `proposal`, `won`, `lost` |
| `consultation booked` | `proposal`, `won`, `lost` |
| `proposal` | `won`, `lost` |
| `won` | none |
| `lost` | none |

Same-status changes are rejected. Dashboard actions do not expose reopening a `won`/`lost` lead, even though the lower-level transition helper has an optional reopen flag.

### Supporting records

- **Task:** `id`, `leadId`, `type`, `dueAt`, `status`, `assignee`, optional `escalatedAt`. Task types are `acknowledgement`, `follow_up`, `collect_contact_details`, `consultation`, `proposal`, and `other`; statuses are `open`, `in_progress`, `overdue`, `done`, and `cancelled`.
- **Outbox message:** `id`, `leadId`, `channel`, `kind`, `recipient`, optional `subject`, `body`, `status`, `createdAt`, optional `sentAt`. Channels are `email`, `whatsapp`, `sms`, and `in_app`; kinds are `acknowledgement` and `internal_notification`.
- **Activity entry:** `id`, `leadId`, `type`, `message`, `at`, optional `actor` and metadata.

All three are stored alongside the lead in the same JSON state.

## Automation Rules and Defaults

The defaults live in `DEFAULT_AUTOMATION_CONFIG` in `src/automation/config.ts`. A caller can pass a replacement config to either `createLeadIntake` or `createLeadActions`.

| Setting | Default |
| --- | --- |
| Team | `Aarav Mehta`, `Priya Nair`, `Rohan Kapoor` |
| Routing rule 1 | project type `kitchen` or `bathroom` -> `Priya Nair` |
| Routing rule 2 | location `Pune` or `Mumbai` -> `Rohan Kapoor` |
| Hot project types | `full home`, `kitchen` |
| Hot timelines | `asap`, `immediately`, `within 1 month`, `0-3 months` |
| Cold timelines | `exploring`, `no rush`, `6+ months`, `12+ months` |
| Follow-up target, hot | 2 hours |
| Follow-up target, standard | 24 hours |
| Follow-up target, cold | 48 hours |
| Collect-contact task target | 4 hours |
| Collect-contact next action | `Collect contact details.` |

Rule and timeline matching is trimmed and case-insensitive. Routing rules are evaluated in order: an existing owner is preserved; otherwise project-type rules are checked before location rules. If no rule matches, the fallback is a deterministic hash of the lead id modulo the team list, not workload-aware round-robin. The lower-level `lead_created` event accepts a `roundRobinIndex`, but the intake service does not supply one.

Default next actions are:

| Status | Next action |
| --- | --- |
| `new` | Review the enquiry and make first contact. |
| `qualified` | Book a consultation with the lead. |
| `contacted` | Confirm requirements and agree the next step. |
| `consultation booked` | Prepare for the consultation. |
| `proposal` | Follow up on the proposal. |
| `won` | Send the welcome pack and hand off to delivery. |
| `lost` | Record the reason and close out the enquiry. |

### 1. Lead created

Trigger: `lead_created`, normally from `submitLead`.

- Missing status becomes `new`. A terminal lead skips owner assignment, acknowledgement, and tasks; it still refreshes timestamps and writes a terminal-skip log.
- An owner is assigned by the routing rules if none exists. Assignment writes an `owner_assigned` log and queues an `in_app` internal notification to the new owner.
- Contact preference determines the acknowledgement target:
  - preferred `email` + valid email -> email
  - preferred `phone` + valid phone -> SMS
  - preferred `whatsapp` + valid phone -> WhatsApp
  - otherwise valid email first, then valid phone/SMS
- With a contact target, an acknowledgement outbox entry is queued and an `outbox_queued` log is written.
- Without a phone or email, no acknowledgement is queued. The lead's next action becomes `Collect contact details.`, an `acknowledgement_skipped` log is written, and a `collect_contact_details` task is created with the configured 4-hour target.
- A `follow_up` task is created if the lead has no active follow-up task. The due time is based on the hot/standard/cold rules above. The intake service starts with no existing tasks, so a normal new lead gets one follow-up.
- Lead timestamps, owner, acknowledgement, and tasks are all persisted by the intake service. Nothing is delivered.

### 2. Auto qualification

The explicit rule is in `src/automation/qualification.ts` and is not part of `AutomationConfig`.

A lead auto-qualifies only when all of the following are true:

- Current status is `new`.
- `projectType`, `budgetRange`, and `timeline` contain non-whitespace text.
- A valid normalized phone or email exists.

When it matches, the lead moves from `new` to `qualified` through the normal status rule, updating next action and timestamps and writing a `status_changed` log. It does not queue an acknowledgement or create a consultation task.

Intake runs this rule after creating a lead, after merging a duplicate into a non-terminal lead, and after non-terminal `updateLeadFields` calls. It never reopens or regresses an already qualified/contacted lead. The dashboard's status action does not auto-qualify; it applies the requested status directly.

### 3. Duplicate submission

Trigger: a normalized phone or email matches an existing lead, or the `duplicate_submission` automation event is invoked directly.

- Intake checks phone first, then email, and uses the first match in repository order.
- Mergeable fields are `name`, `phone`, `email`, `preferredContactMethod`, `projectType`, `propertyType`, `location`, `size`, `budgetRange`, `timeline`, and `notes`.
- Source, status, owner, and ids are not merged. The original source is preserved.
- `lastActivity` and `updatedAt` are refreshed.
- A `duplicate_submission` activity entry lists the merged fields.
- No acknowledgement is queued, no new follow-up is created, and routing/task due dates are not recalculated.
- Intake then runs auto-qualification when the existing lead is not `won`/`lost`.

### 4. Status changed

Trigger: `updateStatus` from the dashboard actions, or auto-qualification inside intake.

- The transition table above is enforced before the rule runs.
- The rule updates status, next action, `lastActivity`, and `updatedAt`, and writes a `status_changed` log.
- Moving to `won` or `lost` cancels every active task (`open`, `in_progress`, or `overdue`) and writes a cancellation log for each.
- No follow-up task is created by a status change. In particular, no consultation or proposal task is auto-created for those stages.
- An optional dashboard status note is trimmed, written as a separate `note_added` activity entry, and does not modify `lead.notes`.
- Invalid transitions are rejected by actions with `INVALID_TRANSITION`; the pure rule has its own rejection log for direct callers.

### 5. Reassignment

Trigger: `reassign` from the dashboard actions.

- The new owner must be a non-empty string. The action does not require the owner to exist in the configured team.
- Reassignment to the same owner, compared trimmed and case-insensitively, is a no-op with no writes, logs, or notifications.
- Otherwise the owner and timestamps are updated and an `owner_assigned` log is written.
- An `in_app` notification is queued for the new owner and, when there was a previous owner, another for the previous owner.
- Active tasks are moved to the new owner. `done` and `cancelled` tasks are unchanged.
- Reassignment can be applied to closed leads for record keeping. It does not create a follow-up task.

### 6. Overdue escalation

Trigger: `runOverdueCheck`, on demand. There is no scheduler.

- A task is escalated only if it is `open` or `in_progress`, has no `escalatedAt`, has a valid `dueAt`, and is due at or before the check time.
- The task becomes `overdue`, receives `escalatedAt`, an `in_app` notification is queued to its assignee (or `unassigned`), and an `overdue_task` log is written.
- Running the check again does nothing to tasks that are already overdue or escalated. A second immediate run returns empty task/message/log arrays.
- `listLeads({ overdue: true/false })` and the dashboard summary calculate overdue leads from task due dates and the injected clock even if `runOverdueCheck` has not run. The check is what writes the escalated state and notification.

## Dashboard Action Interface

Construct actions with a repository and optional clock/config:

```ts
import { resolve } from "node:path";

import { createLeadActions } from "./src/actions/leadActions";
import { createFixedClock } from "./src/lib/clock";
import { FileLeadRepository } from "./src/store/fileLeadStore";

const repository = new FileLeadRepository({
  filePath: resolve("data/demo-store.json"),
});
const actions = createLeadActions({
  repository,
  clock: createFixedClock("2026-11-02T09:00:00.000Z"),
});

const result = await actions.listLeads({ status: "new" });
```

`FileLeadRepository` uses `node:fs`, so call these services from Node/server-side code. There is currently no server route or UI calling them.

Every action resolves to:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ActionErrorCode; message: string } };
```

Stable error codes:

| Code | Meaning |
| --- | --- |
| `NOT_FOUND` | The lead or task id does not exist. |
| `INVALID_TRANSITION` | The requested status change is not allowed. |
| `INVALID_INPUT` | An id, filter, owner, note, date, or other input is malformed. |

Repository failures are not converted into action errors.

| Action | Signature | Success data |
| --- | --- | --- |
| `listLeads` | `(filters?: LeadFilters) => Promise<ActionResult<Lead[]>>` | Filtered leads in repository order. |
| `getLead` | `(id: string) => Promise<ActionResult<LeadDetail>>` | Lead plus tasks, outbox messages, and activity log. |
| `updateStatus` | `(id: string, status: LeadStatus, note?: string) => Promise<ActionResult<LeadDetail>>` | Updated detail. |
| `reassign` | `(id: string, owner: string) => Promise<ActionResult<LeadDetail>>` | Updated detail. |
| `completeTask` | `(taskId: string) => Promise<ActionResult<Task>>` | Completed task. |
| `addNote` | `(id: string, text: string) => Promise<ActionResult<ActivityLogEntry>>` | New activity entry. |
| `runOverdueCheck` | `(now?: Date) => Promise<ActionResult<OverdueResult>>` | Changed tasks, queued messages, and log entries. |
| `getDashboardSummary` | `() => Promise<ActionResult<DashboardSummary>>` | Counts for dashboard cards. |

```ts
interface LeadFilters {
  status?: LeadStatus;
  owner?: string;
  overdue?: boolean;
  source?: LeadSource;
  search?: string;
}

interface LeadDetail {
  lead: Lead;
  tasks: Task[];
  outboxMessages: OutboxMessage[];
  activityLog: ActivityLogEntry[];
}

interface DashboardSummary {
  totalLeads: number;
  byStatus: Record<LeadStatus, number>;
  overdue: number;
  withoutContactDetails: number;
  unassigned: number;
}
```

Filters combine with AND. Status and source are exact. Owner is trimmed and case-insensitive. Search is trimmed, case-insensitive, and scans id, name, phone, email, project, property, location, size, budget, timeline, source, status, owner, next action, and notes. `overdue: true` matches leads with any task already in `overdue` status or an `open`/`in_progress` task due at or before the injected clock; `overdue: false` is the inverse.

Summary definitions:

- `byStatus` always includes all seven statuses, including zeros.
- `overdue` counts leads, not tasks, using the same rule as the overdue filter.
- `withoutContactDetails` counts leads with neither a valid normalized phone nor a valid email.
- `unassigned` counts leads with a missing or blank owner.

Additional action behavior:

- Unknown lead/task ids return `NOT_FOUND`; blank ids return `INVALID_INPUT`.
- Same-status changes and reopen attempts from `won`/`lost` return `INVALID_TRANSITION`.
- Completing an already completed task succeeds without a duplicate activity entry. Completing a cancelled task returns `INVALID_INPUT`.
- `addNote` appends trimmed text to `lead.notes`, updates lead timestamps, and writes a `note_added` entry. Notes are allowed on closed leads.
- Reassignment, notes, task reads, and summaries remain available for closed leads; status changes do not.

## Intake Adapter Usage

Construct the intake service with the same repository and clock used by the actions:

```ts
import { createLeadIntake } from "./src/intake/leadIntake";

const intake = createLeadIntake({
  repository,
  clock: createFixedClock("2026-11-02T09:00:00.000Z"),
});
```

There is no website form or chatbot in the repository. When either is built, it should call this service instead of duplicating validation or automation.

### Website form

```ts
const payload = {
  name: "Ananya Rao",
  phone: "+91 90000 11111",
  email: "ananya@example.com",
  preferredContactMethod: "email",
  projectType: "apartment",
  propertyType: "apartment",
  location: "Bengaluru",
  size: "1,150 sq ft",
  budgetRange: "25-40 lakh",
  timeline: "1-3 months",
  notes: "Interested in a full-home refresh.",
};

const result = await intake.submitLead(payload, "website form");

if (result.ok) {
  console.log(result.data.leadId, result.data.outcome);
} else {
  console.error(result.error.code, result.error.message);
}
```

### Chatbot

The chatbot should create once, retain the returned lead id, and send progressive answers to that lead:

```ts
const started = await intake.submitLead(
  { name: "Chat Visitor", projectType: "villa" },
  "chatbot",
);

if (started.ok) {
  await intake.updateLeadFields(started.data.leadId, {
    phone: "+91 90000 22222",
  });
  await intake.updateLeadFields(started.data.leadId, {
    budgetRange: "1-2 crore",
  });
  await intake.updateLeadFields(started.data.leadId, {
    timeline: "3-6 months",
  });
}
```

### Intake behavior

- `submitLead(payload, source)` accepts an unknown payload plus one of the five supported sources. The source argument is authoritative and is not read from the payload.
- Only these fields are accepted: `name`, `phone`, `email`, `preferredContactMethod`, `projectType`, `propertyType`, `location`, `size`, `budgetRange`, `timeline`, and `notes`. Caller-supplied ids, status, owner, source, timestamps, and next action are ignored.
- Payloads are normalized by the shared validator. Invalid contact values or field types and empty/unknown-only payloads return `INVALID_INPUT`.
- New leads receive a generated id, start as `new`, run `lead_created`, then run auto-qualification. A complete submission can therefore be returned as `qualified`.
- Duplicates merge by normalized phone first, then normalized email, with no second acknowledgement. The original source is preserved.
- A submission against a `won`/`lost` lead merges the allowed fields but preserves the terminal status, writes a `closed_lead_review` log, and returns `flaggedForReview: true` with `reviewReason: "closed_lead"`. It does not reopen the lead.
- `updateLeadFields(id, partial)` accepts the same field whitelist. It updates timestamps, writes a `lead_updated` entry, and re-runs auto-qualification for non-terminal leads. Against `won`/`lost`, it persists the fields but flags the update instead of changing status.
- Adding contact details later does not queue an acknowledgement and does not complete an existing `collect_contact_details` task. Those actions only happen during lead creation or explicit dashboard task completion.

```ts
interface SubmitLeadResult {
  leadId: string;
  outcome: "created" | "merged";
  acknowledgementQueued: boolean;
  owner?: string;
  status: LeadStatus;
  flaggedForReview: boolean;
  reviewReason?: "closed_lead";
  matchedBy?: "phone" | "email";
}

interface UpdateLeadFieldsResult {
  leadId: string;
  status: LeadStatus;
  updatedFields: IntakeFieldName[];
  autoQualified: boolean;
  flaggedForReview: boolean;
  reviewReason?: "closed_lead";
}
```

Intake uses the same `ActionResult` envelope and the `NOT_FOUND` / `INVALID_INPUT` error codes as the dashboard actions.

## Demo Data, Clock, and Reset

The default store is `data/demo-store.json`. It contains:

- 15 fictional leads spanning all seven statuses and all five sources
- 8 tasks
- 7 outbox messages
- 12 activity entries
- partial, email-only, and phone-only leads
- a likely duplicate pair sharing a normalized phone number
- won/lost leads and tasks overdue relative to the demo clock

### Seed and reset

```powershell
npm run seed
npm run reset
```

Both replace all four collections with the same deterministic demo state. `reset` is an explicit alias for the same safe replacement; it does not delete unrelated files. The CLI reports the counts and the store/clock it used. With the default clock it reports:

```text
15 leads, 8 tasks, 7 outbox messages, 12 activity entries.
Demo now: 2026-11-02T09:00:00.000Z
```

Use environment variables to avoid touching the default demo file or to change the pinned seed time:

```powershell
$env:HAIKA_STORE_PATH = "$env:TEMP\haika-demo.json"
$env:HAIKA_NOW = "2026-12-15T09:00:00.000Z"
npm run reset
```

- `HAIKA_STORE_PATH` changes the JSON file path.
- `HAIKA_NOW` pins the clock used to generate seed timestamps and due dates. It is a seed/reset CLI setting; it is not a runtime server setting because there is no server.

### Pinning and advancing the runtime clock

Automation and actions use an injected clock. Production default is the system clock. For a reproducible demo, pin it in code:

```ts
import { createFixedClock, createManualClock } from "./src/lib/clock";

const fixed = createFixedClock("2026-11-02T09:00:00.000Z");

const manual = createManualClock("2026-11-02T09:00:00.000Z");
manual.advanceBy(2 * 60 * 60 * 1000);
manual.set("2026-11-02T11:00:00.000Z");
```

`createFixedClock` never advances. `createManualClock` supports `set(value)` and `advanceBy(milliseconds)`. Pass the same clock instance to `createLeadIntake` and `createLeadActions` so overdue checks, timestamps, and summary counts agree.

## Running and Verifying

```powershell
npm run build
npm test
npx vitest run src/automation/automationFlow.test.ts
```

- `npm run build` runs strict TypeScript checking with `tsc --noEmit`.
- `npm test` runs the full Vitest suite.
- The focused command runs the fixed-clock end-to-end scenario covering intake, qualification, duplicate handling, missing contact details, overdue escalation, reassignment, status progression, terminal closure, and dashboard summary.
- There is no lint script configured in `package.json`.

Current verified result: build passes; 110 tests pass across 9 files. There are no external services or network calls in the tests.

## Demo Limitations

These are confirmed against the current code:

- **All messaging is simulated.** Acknowledgements, owner notifications, reassignment notices, and overdue notices are rows in the local outbox with status `queued`. Nothing is sent. There is no email, WhatsApp, SMS, notification, CRM, calendar, payment, or analytics integration.
- **No delivery worker.** Although the outbox type permits `sent` and `failed`, the automation only creates `queued` entries. There is no retry, delivery receipt, template management, opt-out, or deduplication at send time.
- **No auth or permissions.** There is no authentication, authorization, role model, audit of caller identity, rate limiting, CSRF protection, or spam/CAPTCHA protection. Any code with repository access can read or mutate all records.
- **No multi-tenancy.** The store has one global lead/task/outbox/activity namespace and one configurable team. There are no tenant or workspace ids.
- **Demo-grade storage.** State is a plaintext JSON file with no encryption, database, migrations beyond store version 1, backup strategy, or row-level locking. Multi-record writes are not transactional and can partially fail.
- **Concurrency is last-write-wins.** A repository instance serializes its own writes and uses temp-file/rename, but separate processes and callers are not coordinated. The last completed write wins.
- **Routing is sample logic.** Ownership is based on a fixed team plus sample project-type/location rules, with a deterministic id-hash fallback. It is not workload-aware, availability-aware, skill-based, or configurable through a UI. Reassignment does not validate that an owner belongs to the team.
- **Qualification is fixed in code.** The criteria are not exposed through `AutomationConfig`, and a qualified lead is never automatically downgraded.
- **Overdue work is on demand.** There is no scheduler, durable job queue, cron, retry, escalation chain, or background worker. `runOverdueCheck` must be called. List/summary reads can still calculate due tasks as overdue based on the clock.
- **Limited task automation.** Creation only auto-creates `follow_up` and, when contact is missing, `collect_contact_details` tasks. Although consultation/proposal task types exist, stage changes do not create them. Duplicate merges and status changes do not recalculate follow-up due dates or hotness.
- **Late contact details do not trigger onboarding work.** If a lead is created without contact, later `updateLeadFields` calls neither queue an acknowledgement nor complete the collect-contact task.
- **Simple identity resolution.** Deduplication uses exact normalized phone first, then email. There is no fuzzy/name matching, merge review, conflict resolution, or record-unmerge feature.
- **No account/record lifecycle.** There is no delete, archive, bulk update, import/export, pagination, or soft-delete behavior. Lists load all records and filters run in memory.
- **No UI or transport layer.** There is no public website, chatbot, dashboard page, API route, server action, webhook, or realtime channel. The services are only callable from TypeScript.
- **No production observability.** There is no metrics endpoint, structured production logging, tracing, alerting, dead-letter queue, or monitoring. Activity entries are demo history, not a complete audit trail.
- **Limited audit detail.** Activity entries generally record event summaries and selected metadata, not full before/after snapshots of every changed field.
- **No timezone/localization handling.** Timestamps are ISO UTC strings; there is no user timezone, locale, or business-calendar calculation.
- **No CI or lint setup.** The repository has build/test scripts but no lint script and no CI configuration.

## Suggested Production Next Steps

1. Add a server/API layer with authentication, role-based permissions, tenant isolation, rate limiting, and request validation.
2. Replace the JSON file with a transactional database, migrations, locking/optimistic concurrency, indices, pagination, and backups.
3. Implement real messaging and calendar/CRM adapters behind an outbox worker with idempotency, retries, dead-letter handling, templates, consent, and delivery tracking.
4. Replace on-demand overdue checks with a durable scheduled-job system, configurable SLA policies, escalation levels, and retry behavior.
5. Make routing, qualification criteria, follow-up hours, next actions, teams, and owner validation configurable and workload-aware.
6. Add stage-specific task automation, consultation/proposal workflows, calendar availability, and recalculation when lead details or ownership change.
7. Add consent management, PII encryption, retention/deletion workflows, export, access auditing, and complete change history.
8. Add production observability, integration tests against real adapters, CI, linting, formatting, and deployment/runbook documentation.

## History

The original pre-build recon proposed browser storage and a static seed file. That was replaced by the Node JSON repository documented in [STORAGE.md](STORAGE.md). `README.md` still describes the intended full website/chatbot/dashboard demo and contains a stale link to `docs/IMPLEMENTATION_PLAN.md`; the plan currently lives at the repository root.
