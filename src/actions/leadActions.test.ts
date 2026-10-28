import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixedClock } from "../lib/clock";
import { FileLeadRepository } from "../store/fileLeadStore";
import { DEMO_NOW_ISO, seedDemoData } from "../store/seed";
import type { LeadStatus } from "../types/lead";
import {
  createLeadActions,
  type ActionErrorCode,
  type ActionResult,
  type LeadActions,
  type LeadFilters,
} from "./leadActions";

let tempDirectory: string;
let repository: FileLeadRepository;
let actions: LeadActions;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "haika-actions-"));
  repository = new FileLeadRepository({ filePath: join(tempDirectory, "store.json") });
  await seedDemoData(repository);
  actions = createLeadActions({
    repository,
    clock: createFixedClock(DEMO_NOW_ISO),
  });
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

function expectOk<T>(result: ActionResult<T>): T {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.data;
}

function expectError<T>(result: ActionResult<T>, code: ActionErrorCode): void {
  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("Expected the action to fail.");
  }

  expect(result.error.code).toBe(code);
}

describe("lead actions: list and detail", () => {
  it("lists every lead when no filters are supplied", async () => {
    const leads = expectOk(await actions.listLeads());

    expect(leads).toHaveLength(15);
    expect(leads[0]?.id).toBe("lead-001");
  });

  it("filters by status, owner, source, search, and overdue state", async () => {
    const newLeads = expectOk(await actions.listLeads({ status: "new" }));
    const owned = expectOk(await actions.listLeads({ owner: "rohan kapoor" }));
    const referrals = expectOk(await actions.listLeads({ source: "referral" }));
    const searched = expectOk(await actions.listLeads({ search: "MEERA" }));
    const overdue = expectOk(await actions.listLeads({ overdue: true }));
    const current = expectOk(await actions.listLeads({ overdue: false }));
    const combined = expectOk(
      await actions.listLeads({
        status: "new",
        source: "website form",
        overdue: false,
        search: "ananya",
      }),
    );

    expect(newLeads).toHaveLength(4);
    expect(owned).toHaveLength(8);
    expect(referrals).toHaveLength(3);
    expect(searched.map((lead) => lead.id)).toEqual(["lead-003"]);
    expect(overdue.map((lead) => lead.id).sort()).toEqual([
      "lead-003",
      "lead-004",
      "lead-005",
      "lead-015",
    ]);
    expect(current).toHaveLength(11);
    expect(combined.map((lead) => lead.id)).toEqual(["lead-001"]);
  });

  it("rejects invalid filters", async () => {
    const invalidFilters = [
      { status: "bogus" },
      { source: "bogus" },
      { owner: "   " },
      { overdue: "yes" },
      { search: 42 },
      [],
      null,
    ];

    for (const filters of invalidFilters) {
      expectError(
        await actions.listLeads(filters as unknown as LeadFilters),
        "INVALID_INPUT",
      );
    }
  });

  it("returns a lead with its tasks, outbox, and activity log", async () => {
    const detail = expectOk(await actions.getLead("lead-003"));

    expect(detail.lead.name).toBe("Meera Iyer");
    expect(detail.tasks.map((task) => task.id)).toEqual(["task-001"]);
    expect(detail.outboxMessages.map((message) => message.id)).toEqual(["outbox-003"]);
    expect(detail.activityLog.map((entry) => entry.id)).toEqual(["log-004"]);
  });

  it("returns stable errors for an unknown or invalid lead id", async () => {
    expectError(await actions.getLead("lead-999"), "NOT_FOUND");
    expectError(await actions.getLead("   "), "INVALID_INPUT");
  });
});

describe("lead actions: status changes", () => {
  it("updates a valid status and records the optional note", async () => {
    const detail = expectOk(
      await actions.updateStatus("lead-001", "qualified", "Requested a call after 5pm."),
    );

    expect(detail.lead.status).toBe("qualified");
    expect(detail.lead.lastActivity).toBe(DEMO_NOW_ISO);
    expect(detail.lead.updatedAt).toBe(DEMO_NOW_ISO);
    expect(detail.activityLog.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["status_changed", "note_added"]),
    );
    expect(detail.activityLog.find((entry) => entry.type === "note_added")).toMatchObject({
      message: "Requested a call after 5pm.",
      actor: "dashboard",
      metadata: { code: "status_note", from: "new", to: "qualified" },
    });
  });

  it("rejects invalid transitions, including reopening closed leads", async () => {
    expectError(await actions.updateStatus("lead-001", "won"), "INVALID_TRANSITION");
    expectError(await actions.updateStatus("lead-009", "contacted"), "INVALID_TRANSITION");

    const closed = expectOk(await actions.getLead("lead-009"));
    expect(closed.lead.status).toBe("won");
  });

  it("rejects unknown leads, invalid statuses, and non-string notes", async () => {
    expectError(await actions.updateStatus("lead-999", "qualified"), "NOT_FOUND");
    expectError(await actions.updateStatus("   ", "qualified"), "INVALID_INPUT");
    expectError(
      await actions.updateStatus("lead-001", "bogus" as LeadStatus),
      "INVALID_INPUT",
    );
    expectError(
      await actions.updateStatus(
        "lead-001",
        "qualified",
        42 as unknown as string,
      ),
      "INVALID_INPUT",
    );
  });

  it("cancels active tasks when a lead is won", async () => {
    const detail = expectOk(await actions.updateStatus("lead-007", "won"));

    expect(detail.lead.status).toBe("won");
    expect(detail.tasks.find((task) => task.id === "task-005")?.status).toBe("cancelled");
  });
});

describe("lead actions: reassignment", () => {
  it("reassigns the lead, moves active tasks, and queues both notifications", async () => {
    const detail = expectOk(await actions.reassign("lead-005", "Rohan Kapoor"));

    expect(detail.lead.owner).toBe("Rohan Kapoor");
    expect(detail.tasks.find((task) => task.id === "task-003")?.assignee).toBe(
      "Rohan Kapoor",
    );
    expect(
      detail.outboxMessages.some(
        (message) =>
          message.recipient === "Rohan Kapoor" && message.subject === "Lead reassigned to you",
      ),
    ).toBe(true);
    expect(
      detail.outboxMessages.some(
        (message) =>
          message.recipient === "Aarav Mehta" && message.subject === "Lead reassigned away",
      ),
    ).toBe(true);
    expect(detail.activityLog.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["owner_assigned", "task_updated"]),
    );
  });

  it("treats reassignment to the current owner as a silent no-op", async () => {
    const before = expectOk(await actions.getLead("lead-005"));
    const after = expectOk(await actions.reassign("lead-005", "  aarav mehta  "));

    expect(after.lead).toEqual(before.lead);
    expect(after.outboxMessages).toHaveLength(before.outboxMessages.length);
    expect(after.activityLog).toHaveLength(before.activityLog.length);
  });

  it("rejects unknown leads and invalid owners", async () => {
    expectError(await actions.reassign("lead-999", "Rohan Kapoor"), "NOT_FOUND");
    expectError(await actions.reassign("lead-005", "   "), "INVALID_INPUT");
    expectError(
      await actions.reassign("lead-005", 42 as unknown as string),
      "INVALID_INPUT",
    );
  });

  it("allows reassignment of a closed lead for record keeping", async () => {
    const detail = expectOk(await actions.reassign("lead-009", "Rohan Kapoor"));

    expect(detail.lead.status).toBe("won");
    expect(detail.lead.owner).toBe("Rohan Kapoor");
  });
});

describe("lead actions: tasks and notes", () => {
  it("completes an open task and records lead activity", async () => {
    const task = expectOk(await actions.completeTask("task-001"));
    const detail = expectOk(await actions.getLead("lead-003"));

    expect(task.status).toBe("done");
    expect(detail.tasks.find((candidate) => candidate.id === "task-001")?.status).toBe(
      "done",
    );
    expect(detail.lead.lastActivity).toBe(DEMO_NOW_ISO);
    expect(detail.activityLog.find((entry) => entry.type === "task_completed")).toMatchObject({
      actor: "dashboard",
      metadata: { code: "task_completed", taskId: "task-001", to: "done" },
    });
  });

  it("treats completing an already-completed task as a no-op", async () => {
    expectOk(await actions.completeTask("task-001"));
    const before = expectOk(await actions.getLead("lead-003"));
    const second = expectOk(await actions.completeTask("task-001"));
    const after = expectOk(await actions.getLead("lead-003"));

    expect(second.status).toBe("done");
    expect(after.activityLog).toHaveLength(before.activityLog.length);
    expect(after.lead).toEqual(before.lead);
  });

  it("rejects cancelled tasks on closed leads", async () => {
    expectOk(await actions.updateStatus("lead-007", "won"));

    expectError(await actions.completeTask("task-005"), "INVALID_INPUT");
  });

  it("rejects unknown and invalid task ids", async () => {
    expectError(await actions.completeTask("task-999"), "NOT_FOUND");
    expectError(await actions.completeTask("   "), "INVALID_INPUT");
  });

  it("appends a note and records it in the activity log", async () => {
    const entry = expectOk(await actions.addNote("lead-001", "  Callback requested.  "));
    const detail = expectOk(await actions.getLead("lead-001"));

    expect(entry.message).toBe("Callback requested.");
    expect(detail.lead.notes).toBe(
      "Only email was provided on the website form.\nCallback requested.",
    );
    expect(detail.lead.lastActivity).toBe(DEMO_NOW_ISO);
    expect(detail.activityLog.some((candidate) => candidate.id === entry.id)).toBe(true);
  });

  it("allows notes on closed leads", async () => {
    const entry = expectOk(await actions.addNote("lead-011", "Post-mortem note."));

    expect(entry.type).toBe("note_added");
  });

  it("rejects empty notes, invalid ids, and unknown leads", async () => {
    expectError(await actions.addNote("lead-001", "   "), "INVALID_INPUT");
    expectError(await actions.addNote("lead-001", 42 as unknown as string), "INVALID_INPUT");
    expectError(await actions.addNote("   ", "Text"), "INVALID_INPUT");
    expectError(await actions.addNote("lead-999", "Text"), "NOT_FOUND");
  });
});

describe("lead actions: overdue check and summary", () => {
  it("marks open past-due tasks overdue and emits one notification each", async () => {
    const result = expectOk(await actions.runOverdueCheck());

    expect(result.tasks.map((task) => task.id).sort()).toEqual([
      "task-001",
      "task-002",
      "task-008",
    ]);
    expect(result.tasks.every((task) => task.status === "overdue")).toBe(true);
    expect(result.tasks.every((task) => task.escalatedAt === DEMO_NOW_ISO)).toBe(true);
    expect(result.outboxMessages).toHaveLength(3);
    expect(result.logEntries).toHaveLength(3);
  });

  it("is idempotent for already escalated tasks", async () => {
    expectOk(await actions.runOverdueCheck());
    const second = expectOk(await actions.runOverdueCheck());

    expect(second.tasks).toEqual([]);
    expect(second.outboxMessages).toEqual([]);
    expect(second.logEntries).toEqual([]);
  });

  it("rejects an invalid explicit check time", async () => {
    expectError(
      await actions.runOverdueCheck(new Date("not-a-date")),
      "INVALID_INPUT",
    );
  });

  it("summarizes pipeline state for dashboard cards", async () => {
    const summary = expectOk(await actions.getDashboardSummary());

    expect(summary).toEqual({
      totalLeads: 15,
      byStatus: {
        new: 4,
        qualified: 2,
        contacted: 2,
        "consultation booked": 1,
        proposal: 2,
        won: 2,
        lost: 2,
      },
      overdue: 4,
      withoutContactDetails: 1,
      unassigned: 1,
    });
  });
});
