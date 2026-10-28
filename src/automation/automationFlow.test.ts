import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLeadActions,
  type ActionErrorCode,
  type ActionResult,
  type LeadActions,
} from "../actions/leadActions";
import { createLeadIntake, type LeadIntake } from "../intake/leadIntake";
import { createManualClock, type ManualClock } from "../lib/clock";
import { FileLeadRepository } from "../store/fileLeadStore";
import type { Task } from "../types/lead";

const START = "2026-11-02T09:00:00.000Z";
const MINUTE = 60_000;
const ACTIVE_TASK_STATUSES = ["open", "in_progress", "overdue"] as const;

let tempDirectory: string;
let repository: FileLeadRepository;
let clock: ManualClock;
let intake: LeadIntake;
let actions: LeadActions;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "haika-e2e-"));
  repository = new FileLeadRepository({
    filePath: join(tempDirectory, "store.json"),
  });
  clock = createManualClock(START);
  intake = createLeadIntake({ repository, clock });
  actions = createLeadActions({ repository, clock });
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

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${description}.`);
  }

  return value;
}

function activeTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) =>
    (ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status),
  );
}

describe("automation end-to-end flow", () => {
  it("runs intake, qualification, overdue, reassignment, status, closure, and summary together", async () => {
    const websitePayload = {
      name: "Ananya Rao",
      phone: "+91 90000 11111",
      email: "ANANYA@EXAMPLE.COM",
      preferredContactMethod: "email",
      enquiryType: "get free estimate",
      projectType: "kitchen",
      propertyType: "apartment",
      location: "Bengaluru",
      size: "1,150 sq ft",
      budgetRange: "25-40 lakh",
      timeline: "within 1 month",
      notes: "Full kitchen refresh.",
    };

    const websiteCreation = expectOk(
      await intake.submitLead(websitePayload, "website form"),
    );
    const websiteId = websiteCreation.leadId;
    let websiteDetail = expectOk(await actions.getLead(websiteId));

    expect(websiteCreation).toMatchObject({
      outcome: "created",
      acknowledgementQueued: true,
      owner: "Priya Nair",
      status: "qualified",
      flaggedForReview: false,
    });
    expect(websiteDetail.lead).toMatchObject({
      email: "ananya@example.com",
      phone: "+919000011111",
      enquiryType: "get free estimate",
      source: "website form",
      status: "qualified",
      owner: "Priya Nair",
      nextAction: "Book a consultation with the lead.",
    });

    const websiteAcknowledgements = websiteDetail.outboxMessages.filter(
      (message) => message.kind === "acknowledgement",
    );
    expect(websiteAcknowledgements).toHaveLength(1);
    expect(websiteAcknowledgements[0]).toMatchObject({
      channel: "email",
      recipient: "ananya@example.com",
    });
    expect(
      websiteDetail.outboxMessages.filter(
        (message) =>
          message.kind === "internal_notification" &&
          message.recipient === "Priya Nair" &&
          message.subject === "New lead assigned",
      ),
    ).toHaveLength(1);

    const websiteFollowUp = required(
      websiteDetail.tasks.find((task) => task.type === "follow_up"),
      "website follow-up",
    );
    expect(websiteFollowUp).toMatchObject({
      status: "open",
      assignee: "Priya Nair",
      dueAt: "2026-11-02T11:00:00.000Z",
    });
    expect(websiteDetail.tasks).toHaveLength(1);
    expect(websiteDetail.activityLog.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["owner_assigned", "status_changed"]),
    );

    clock.advanceBy(10 * MINUTE);
    const chatbotCreation = expectOk(
      await intake.submitLead({ name: "Chat Visitor" }, "chatbot"),
    );
    const chatbotId = chatbotCreation.leadId;
    const chatbotOwner = required(chatbotCreation.owner, "chatbot owner");

    expect(chatbotCreation).toMatchObject({
      outcome: "created",
      acknowledgementQueued: false,
      status: "new",
      flaggedForReview: false,
    });
    expect(chatbotCreation.leadId).not.toBe(websiteId);
    expect((await repository.listLeads())).toHaveLength(2);

    let chatbotDetail = expectOk(await actions.getLead(chatbotId));
    expect(chatbotDetail.lead).toMatchObject({
      source: "chatbot",
      status: "new",
      owner: chatbotOwner,
      nextAction: "Collect contact details.",
    });
    expect(
      chatbotDetail.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(0);
    expect(
      required(
        chatbotDetail.tasks.find((task) => task.type === "collect_contact_details"),
        "chatbot collect-contact task",
      ).status,
    ).toBe("open");

    clock.advanceBy(MINUTE);
    const afterPhone = expectOk(
      await intake.updateLeadFields(chatbotId, {
        phone: "+91 90000 22222",
      }),
    );
    expect(afterPhone).toMatchObject({
      leadId: chatbotId,
      status: "new",
      updatedFields: ["phone"],
      autoQualified: false,
    });

    clock.advanceBy(MINUTE);
    const afterProject = expectOk(
      await intake.updateLeadFields(chatbotId, {
        projectType: "kitchen",
      }),
    );
    expect(afterProject.status).toBe("new");

    clock.advanceBy(MINUTE);
    const afterBudget = expectOk(
      await intake.updateLeadFields(chatbotId, {
        budgetRange: "25-40 lakh",
      }),
    );
    expect(afterBudget.status).toBe("new");

    clock.advanceBy(MINUTE);
    const afterTimeline = expectOk(
      await intake.updateLeadFields(chatbotId, {
        timeline: "within 1 month",
      }),
    );
    expect(afterTimeline).toMatchObject({
      leadId: chatbotId,
      status: "qualified",
      updatedFields: ["timeline"],
      autoQualified: true,
    });

    chatbotDetail = expectOk(await actions.getLead(chatbotId));
    expect(chatbotDetail.lead).toMatchObject({
      status: "qualified",
      owner: chatbotOwner,
      phone: "+919000022222",
    });
    expect(
      chatbotDetail.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(0);
    expect(
      chatbotDetail.activityLog.filter((entry) => entry.type === "status_changed"),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ from: "new", to: "qualified" }),
      }),
    ]);

    clock.advanceBy(6 * MINUTE);
    const duplicateSubmission = expectOk(
      await intake.submitLead(
        {
          ...websitePayload,
          phone: "+91 90000-11111",
          email: "ANANYA@EXAMPLE.COM",
        },
        "website form",
      ),
    );

    expect(duplicateSubmission).toMatchObject({
      leadId: websiteId,
      outcome: "merged",
      acknowledgementQueued: false,
      matchedBy: "phone",
      status: "qualified",
      flaggedForReview: false,
    });
    expect(await repository.listLeads()).toHaveLength(2);

    websiteDetail = expectOk(await actions.getLead(websiteId));
    expect(
      websiteDetail.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(1);
    expect(
      websiteDetail.outboxMessages.filter(
        (message) => message.subject === "New lead assigned",
      ),
    ).toHaveLength(1);
    expect(websiteDetail.tasks.filter((task) => task.type === "follow_up")).toHaveLength(
      1,
    );
    expect(
      websiteDetail.activityLog.filter((entry) => entry.type === "duplicate_submission"),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: "duplicate_submission",
          mergedFields: expect.arrayContaining(["phone"]),
        }),
      }),
    ]);

    clock.advanceBy(10 * MINUTE);
    const noContactCreation = expectOk(
      await intake.submitLead({ name: "Walk-in Prospect" }, "referral"),
    );
    const noContactId = noContactCreation.leadId;

    expect(noContactCreation).toMatchObject({
      outcome: "created",
      acknowledgementQueued: false,
      status: "new",
      flaggedForReview: false,
    });
    expect(noContactCreation.owner).toBeTypeOf("string");

    let noContactDetail = expectOk(await actions.getLead(noContactId));
    expect(noContactDetail.lead).toMatchObject({
      name: "Walk-in Prospect",
      status: "new",
      source: "referral",
      nextAction: "Collect contact details.",
    });
    expect(noContactDetail.lead.phone).toBeUndefined();
    expect(noContactDetail.lead.email).toBeUndefined();
    expect(noContactDetail.tasks).toHaveLength(2);
    expect(
      required(
        noContactDetail.tasks.find((task) => task.type === "collect_contact_details"),
        "no-contact collect-contact task",
      ),
    ).toMatchObject({
      status: "open",
      dueAt: "2026-11-02T13:30:00.000Z",
    });
    expect(
      noContactDetail.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(0);
    expect(
      noContactDetail.activityLog.find(
        (entry) => entry.type === "acknowledgement_skipped",
      ),
    ).toMatchObject({
      metadata: { code: "no_contact_details" },
    });

    clock.set("2026-11-02T11:01:00.000Z");
    const overdue = expectOk(await actions.runOverdueCheck());

    expect(overdue.tasks).toHaveLength(1);
    expect(overdue.tasks[0]).toMatchObject({
      id: websiteFollowUp.id,
      status: "overdue",
      escalatedAt: "2026-11-02T11:01:00.000Z",
    });
    expect(overdue.outboxMessages).toEqual([
      expect.objectContaining({
        leadId: websiteId,
        recipient: "Priya Nair",
        subject: "Overdue follow-up",
        kind: "internal_notification",
      }),
    ]);
    expect(overdue.logEntries).toEqual([
      expect.objectContaining({
        leadId: websiteId,
        type: "overdue_task",
        metadata: expect.objectContaining({
          code: "task_overdue",
          taskId: websiteFollowUp.id,
        }),
      }),
    ]);

    const duplicateOverdueRun = expectOk(await actions.runOverdueCheck());
    expect(duplicateOverdueRun.tasks).toEqual([]);
    expect(duplicateOverdueRun.outboxMessages).toEqual([]);
    expect(duplicateOverdueRun.logEntries).toEqual([]);

    websiteDetail = expectOk(await actions.getLead(websiteId));
    expect(required(
      websiteDetail.tasks.find((task) => task.id === websiteFollowUp.id),
      "overdue website follow-up",
    ).status).toBe("overdue");

    clock.set("2026-11-02T11:05:00.000Z");
    const reassigned = expectOk(await actions.reassign(websiteId, "Rohan Kapoor"));

    expect(reassigned.lead.owner).toBe("Rohan Kapoor");
    expect(
      required(
        reassigned.tasks.find((task) => task.id === websiteFollowUp.id),
        "reassigned follow-up",
      ),
    ).toMatchObject({
      status: "overdue",
      assignee: "Rohan Kapoor",
    });
    expect(reassigned.tasks).toHaveLength(1);
    expect(
      reassigned.outboxMessages.filter(
        (message) =>
          message.recipient === "Rohan Kapoor" &&
          message.subject === "Lead reassigned to you",
      ),
    ).toHaveLength(1);
    expect(
      reassigned.outboxMessages.filter(
        (message) =>
          message.recipient === "Priya Nair" &&
          message.subject === "Lead reassigned away",
      ),
    ).toHaveLength(1);

    clock.set("2026-11-02T11:10:00.000Z");
    const beforeInvalidJump = expectOk(await actions.getLead(websiteId));
    expectError(
      await actions.updateStatus(websiteId, "won"),
      "INVALID_TRANSITION",
    );
    const afterInvalidJump = expectOk(await actions.getLead(websiteId));

    expect(afterInvalidJump.lead.status).toBe("qualified");
    expect(afterInvalidJump.lead.lastActivity).toBe(beforeInvalidJump.lead.lastActivity);
    expect(afterInvalidJump.activityLog).toHaveLength(
      beforeInvalidJump.activityLog.length,
    );

    for (const [at, status] of [
      ["2026-11-02T11:11:00.000Z", "contacted"],
      ["2026-11-02T11:12:00.000Z", "consultation booked"],
      ["2026-11-02T11:13:00.000Z", "proposal"],
      ["2026-11-02T11:14:00.000Z", "won"],
    ] as const) {
      clock.set(at);
      const updated = expectOk(await actions.updateStatus(websiteId, status));

      expect(updated.lead.status).toBe(status);
      expect(updated.tasks).toHaveLength(1);
      expect(updated.tasks.filter((task) => task.type === "follow_up")).toHaveLength(
        1,
      );
    }

    const wonDetail = expectOk(await actions.getLead(websiteId));
    expect(wonDetail.lead).toMatchObject({
      status: "won",
      owner: "Rohan Kapoor",
      nextAction: "Send the welcome pack and hand off to delivery.",
    });
    expect(
      required(
        wonDetail.tasks.find((task) => task.id === websiteFollowUp.id),
        "cancelled won follow-up",
      ),
    ).toMatchObject({
      status: "cancelled",
      assignee: "Rohan Kapoor",
    });
    expect(activeTasks(wonDetail.tasks)).toEqual([]);
    expect(
      wonDetail.activityLog
        .filter((entry) => entry.type === "status_changed")
        .map(
          (entry) =>
            `${String(entry.metadata?.["from"])} -> ${String(entry.metadata?.["to"])}`,
        ),
    ).toEqual([
      "new -> qualified",
      "qualified -> contacted",
      "contacted -> consultation booked",
      "consultation booked -> proposal",
      "proposal -> won",
    ]);

    clock.set("2026-11-02T11:20:00.000Z");
    const lostDetail = expectOk(await actions.updateStatus(chatbotId, "lost"));

    expect(lostDetail.lead.status).toBe("lost");
    expect(lostDetail.tasks).toHaveLength(2);
    expect(lostDetail.tasks.every((task) => task.status === "cancelled")).toBe(true);
    expect(lostDetail.tasks.filter((task) => task.type === "follow_up")).toHaveLength(
      1,
    );
    expect(activeTasks(lostDetail.tasks)).toEqual([]);

    const lostLogCount = lostDetail.activityLog.length;
    clock.advanceBy(MINUTE);
    const lostDuplicate = expectOk(
      await intake.submitLead(
        { phone: "+91 90000 22222", notes: "Submitted again after closure." },
        "chatbot",
      ),
    );

    expect(lostDuplicate).toMatchObject({
      leadId: chatbotId,
      outcome: "merged",
      acknowledgementQueued: false,
      status: "lost",
      flaggedForReview: true,
      reviewReason: "closed_lead",
    });

    const lostAfterDuplicate = expectOk(await actions.getLead(chatbotId));
    expect(lostAfterDuplicate.lead.status).toBe("lost");
    expect(lostAfterDuplicate.tasks).toHaveLength(2);
    expect(lostAfterDuplicate.tasks.every((task) => task.status === "cancelled")).toBe(
      true,
    );
    expect(
      lostAfterDuplicate.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(0);
    expect(lostAfterDuplicate.activityLog.length).toBeGreaterThan(lostLogCount);
    expect(
      lostAfterDuplicate.activityLog.slice(lostLogCount).map((entry) => entry.type),
    ).toEqual(expect.arrayContaining(["duplicate_submission", "other"]));
    expect(
      lostAfterDuplicate.activityLog.slice(lostLogCount).some(
        (entry) => entry.metadata?.["code"] === "closed_lead_review",
      ),
    ).toBe(true);

    const wonLogCount = wonDetail.activityLog.length;
    const wonAcknowledgementCount = wonDetail.outboxMessages.filter(
      (message) => message.kind === "acknowledgement",
    ).length;
    clock.advanceBy(MINUTE);
    const wonDuplicate = expectOk(
      await intake.submitLead(websitePayload, "website form"),
    );

    expect(wonDuplicate).toMatchObject({
      leadId: websiteId,
      outcome: "merged",
      acknowledgementQueued: false,
      status: "won",
      flaggedForReview: true,
      reviewReason: "closed_lead",
    });

    const wonAfterDuplicate = expectOk(await actions.getLead(websiteId));
    expect(wonAfterDuplicate.lead.status).toBe("won");
    expect(wonAfterDuplicate.tasks).toHaveLength(1);
    expect(wonAfterDuplicate.tasks[0]?.status).toBe("cancelled");
    expect(
      wonAfterDuplicate.outboxMessages.filter(
        (message) => message.kind === "acknowledgement",
      ),
    ).toHaveLength(wonAcknowledgementCount);
    expect(wonAfterDuplicate.activityLog.length).toBeGreaterThan(wonLogCount);
    expect(
      wonAfterDuplicate.activityLog.slice(wonLogCount).map((entry) => entry.type),
    ).toEqual(expect.arrayContaining(["duplicate_submission", "other"]));
    expect(
      wonAfterDuplicate.activityLog.slice(wonLogCount).some(
        (entry) => entry.metadata?.["code"] === "closed_lead_review",
      ),
    ).toBe(true);

    const allTasks = await repository.listTasks();
    expect(allTasks.filter((task) => task.type === "follow_up")).toHaveLength(3);
    expect(
      allTasks.filter(
        (task) =>
          (task.leadId === websiteId || task.leadId === chatbotId) &&
          (ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status),
      ),
    ).toEqual([]);

    noContactDetail = expectOk(await actions.getLead(noContactId));
    expect(activeTasks(noContactDetail.tasks)).toHaveLength(2);

    clock.set("2026-11-02T11:23:00.000Z");
    const summary = expectOk(await actions.getDashboardSummary());

    expect(summary).toEqual({
      totalLeads: 3,
      byStatus: {
        new: 1,
        qualified: 0,
        contacted: 0,
        "consultation booked": 0,
        proposal: 0,
        won: 1,
        lost: 1,
      },
      overdue: 0,
      withoutContactDetails: 1,
      unassigned: 0,
    });
    expect(expectOk(await actions.listLeads({ overdue: true }))).toEqual([]);
  });
});
