import { describe, expect, it } from "vitest";

import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from "./config";
import { applyAutomationRules, markOverdueTasks } from "./rules";
import type { Lead, LeadStatus, PartialLead, Task } from "../types/lead";

const NOW = new Date("2026-11-02T09:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const LATER = new Date("2026-11-03T09:00:00.000Z");

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    name: "Ada Lovelace",
    phone: "+91 98765-43210",
    email: "ada@example.com",
    preferredContactMethod: "email",
    projectType: "kitchen",
    propertyType: "apartment",
    location: "Pune",
    size: "1200 sq ft",
    budgetRange: "25-40 lakh",
    timeline: "within 1 month",
    source: "website form",
    status: "new",
    createdAt: "2026-10-30T08:00:00.000Z",
    updatedAt: "2026-10-30T08:00:00.000Z",
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<Task> & Pick<Task, "id" | "type">,
): Task {
  return {
    leadId: "lead-1",
    dueAt: "2026-11-02T08:00:00.000Z",
    status: "open",
    assignee: "Priya Nair",
    ...overrides,
  };
}

function configWith(overrides: Partial<AutomationConfig>): AutomationConfig {
  return { ...DEFAULT_AUTOMATION_CONFIG, ...overrides };
}

describe("acknowledgement and creation", () => {
  it("queues an acknowledgement using the preferred email and assigns a routed owner", () => {
    const result = applyAutomationRules(makeLead(), { type: "lead_created" }, NOW);

    const ack = result.outboxMessages.find((message) => message.kind === "acknowledgement");
    const internal = result.outboxMessages.find(
      (message) => message.kind === "internal_notification",
    );
    const followUp = result.tasks.find((task) => task.type === "follow_up");

    expect(result.leadChanges.owner).toBe("Priya Nair");
    expect(result.leadChanges.lastActivity).toBe(NOW_ISO);
    expect(result.leadChanges.updatedAt).toBe(NOW_ISO);
    expect(result.leadChanges.nextAction).toBe(
      DEFAULT_AUTOMATION_CONFIG.defaultNextActions.new,
    );
    expect(ack).toMatchObject({
      channel: "email",
      recipient: "ada@example.com",
      subject: "We received your enquiry",
      status: "queued",
    });
    expect(internal).toMatchObject({
      channel: "in_app",
      recipient: "Priya Nair",
      subject: "New lead assigned",
    });
    expect(followUp).toMatchObject({
      assignee: "Priya Nair",
      status: "open",
      dueAt: "2026-11-02T11:00:00.000Z",
    });
    expect(result.logEntries.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["owner_assigned", "outbox_queued", "task_created"]),
    );
  });

  it("uses SMS for a phone preference and WhatsApp when requested", () => {
    const sms = applyAutomationRules(
      makeLead({ preferredContactMethod: "phone", projectType: "living room" }),
      { type: "lead_created" },
      NOW,
    );
    const whatsapp = applyAutomationRules(
      makeLead({ preferredContactMethod: "whatsapp", projectType: "living room" }),
      { type: "lead_created" },
      NOW,
    );

    expect(
      sms.outboxMessages.find((message) => message.kind === "acknowledgement"),
    ).toMatchObject({ channel: "sms", recipient: "+919876543210" });
    expect(
      whatsapp.outboxMessages.find((message) => message.kind === "acknowledgement"),
    ).toMatchObject({ channel: "whatsapp", recipient: "+919876543210" });
  });

  it("falls back to the contact detail that exists when the preferred method is unavailable", () => {
    const emailFallback = applyAutomationRules(
      makeLead({
        phone: undefined,
        preferredContactMethod: "phone",
        projectType: "living room",
      }),
      { type: "lead_created" },
      NOW,
    );
    const smsFallback = applyAutomationRules(
      makeLead({
        email: undefined,
        preferredContactMethod: "email",
        projectType: "living room",
      }),
      { type: "lead_created" },
      NOW,
    );
    const noPreference = applyAutomationRules(
      makeLead({ preferredContactMethod: undefined, projectType: "living room" }),
      { type: "lead_created" },
      NOW,
    );

    expect(
      emailFallback.outboxMessages.find((message) => message.kind === "acknowledgement"),
    ).toMatchObject({ channel: "email", recipient: "ada@example.com" });
    expect(
      smsFallback.outboxMessages.find((message) => message.kind === "acknowledgement"),
    ).toMatchObject({ channel: "sms", recipient: "+919876543210" });
    expect(
      noPreference.outboxMessages.find((message) => message.kind === "acknowledgement"),
    ).toMatchObject({ channel: "email" });
  });

  it("skips the acknowledgement, logs it, and creates a collect-contact task when no contact exists", () => {
    const result = applyAutomationRules(
      makeLead({
        phone: undefined,
        email: undefined,
        preferredContactMethod: undefined,
      }),
      { type: "lead_created" },
      NOW,
    );

    const collectTask = result.tasks.find(
      (task) => task.type === "collect_contact_details",
    );

    expect(
      result.outboxMessages.some((message) => message.kind === "acknowledgement"),
    ).toBe(false);
    expect(result.leadChanges.nextAction).toBe(
      DEFAULT_AUTOMATION_CONFIG.collectContactDetailsAction,
    );
    expect(collectTask).toMatchObject({
      status: "open",
      assignee: "Priya Nair",
      dueAt: "2026-11-02T13:00:00.000Z",
    });
    expect(result.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "acknowledgement_skipped" }),
      ]),
    );
    expect(result.tasks.some((task) => task.type === "follow_up")).toBe(true);
  });

  it("does not create duplicate follow-up or collect-contact tasks", () => {
    const tasks = [
      makeTask({ id: "existing-follow-up", type: "follow_up" }),
      makeTask({ id: "existing-collect", type: "collect_contact_details" }),
    ];

    const result = applyAutomationRules(
      makeLead({
        phone: undefined,
        email: undefined,
        preferredContactMethod: undefined,
      }),
      { type: "lead_created", tasks },
      NOW,
    );

    expect(result.tasks).toEqual([]);
  });

  it("does not acknowledge or create follow-ups for a terminal lead", () => {
    const result = applyAutomationRules(
      makeLead({ status: "won" }),
      { type: "lead_created" },
      NOW,
    );

    expect(result.tasks).toEqual([]);
    expect(result.outboxMessages).toEqual([]);
    expect(result.leadChanges.owner).toBeUndefined();
    expect(result.logEntries).toEqual([
      expect.objectContaining({
        type: "other",
        metadata: expect.objectContaining({ code: "terminal_lead" }),
      }),
    ]);
  });
});

describe("routing and follow-up timing", () => {
  it("routes by project type before location and by location when no project rule matches", () => {
    const byProject = applyAutomationRules(
      makeLead({ projectType: "kitchen", location: "Delhi" }),
      { type: "lead_created" },
      NOW,
    );
    const byLocation = applyAutomationRules(
      makeLead({ projectType: "living room", location: "Mumbai" }),
      { type: "lead_created" },
      NOW,
    );

    expect(byProject.leadChanges.owner).toBe("Priya Nair");
    expect(byLocation.leadChanges.owner).toBe("Rohan Kapoor");
  });

  it("uses a deterministic round-robin fallback from config", () => {
    const config = configWith({
      team: ["Alex", "Blair", "Casey"],
      routingRules: [],
      hotProjectTypes: [],
    });

    const owners = [0, 1, 2, 3].map((roundRobinIndex) =>
      applyAutomationRules(
        makeLead({ projectType: "office", location: "Delhi", owner: undefined }),
        { type: "lead_created", roundRobinIndex },
        NOW,
        config,
      ).leadChanges.owner,
    );

    expect(owners).toEqual(["Alex", "Blair", "Casey", "Alex"]);
  });

  it("keeps an existing owner and does not send an assignment notification", () => {
    const result = applyAutomationRules(
      makeLead({ owner: "Sam Rivera" }),
      { type: "lead_created" },
      NOW,
    );

    expect(result.leadChanges.owner).toBeUndefined();
    expect(
      result.outboxMessages.some((message) => message.kind === "internal_notification"),
    ).toBe(false);
    expect(result.tasks.find((task) => task.type === "follow_up")?.assignee).toBe(
      "Sam Rivera",
    );
  });

  it("derives follow-up due times from config for hot, standard, and cold leads", () => {
    const hotProject = applyAutomationRules(
      makeLead({ projectType: "kitchen", timeline: "flexible" }),
      { type: "lead_created" },
      NOW,
    );
    const hotTimeline = applyAutomationRules(
      makeLead({ projectType: "living room", timeline: "ASAP" }),
      { type: "lead_created" },
      NOW,
    );
    const cold = applyAutomationRules(
      makeLead({ projectType: "living room", timeline: "exploring" }),
      { type: "lead_created" },
      NOW,
    );
    const standard = applyAutomationRules(
      makeLead({ projectType: "living room", timeline: "1-3 months" }),
      { type: "lead_created" },
      NOW,
    );

    expect(hotProject.tasks.find((task) => task.type === "follow_up")?.dueAt).toBe(
      "2026-11-02T11:00:00.000Z",
    );
    expect(hotTimeline.tasks.find((task) => task.type === "follow_up")?.dueAt).toBe(
      "2026-11-02T11:00:00.000Z",
    );
    expect(cold.tasks.find((task) => task.type === "follow_up")?.dueAt).toBe(
      "2026-11-04T09:00:00.000Z",
    );
    expect(standard.tasks.find((task) => task.type === "follow_up")?.dueAt).toBe(
      "2026-11-03T09:00:00.000Z",
    );
  });

  it("honors custom follow-up timing in config", () => {
    const config = configWith({
      followUpHours: { hot: 1, standard: 8, cold: 12 },
      hotTimelines: ["asap"],
    });

    const result = applyAutomationRules(
      makeLead({ timeline: "asap", projectType: "living room" }),
      { type: "lead_created" },
      NOW,
      config,
    );

    expect(result.tasks.find((task) => task.type === "follow_up")?.dueAt).toBe(
      "2026-11-02T10:00:00.000Z",
    );
  });
});

describe("duplicate submissions", () => {
  it("merges incoming fields, logs the duplicate, and never creates a second lead", () => {
    const result = applyAutomationRules(
      makeLead(),
      {
        type: "duplicate_submission",
        submission: {
          name: "  Ada Byron  ",
          phone: " 98765 43210 ",
          email: " NEW@Example.com ",
          projectType: "bathroom",
          status: "won",
          owner: "Intruder",
          source: "campaign",
        },
      },
      NOW,
    );

    expect(result.leadChanges).toMatchObject({
      name: "Ada Byron",
      phone: "9876543210",
      email: "new@example.com",
      projectType: "bathroom",
      lastActivity: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(result.leadChanges.id).toBeUndefined();
    expect(result.leadChanges.status).toBeUndefined();
    expect(result.leadChanges.owner).toBeUndefined();
    expect(result.leadChanges.source).toBeUndefined();
    expect(result.leadChanges.createdAt).toBeUndefined();
    expect(result.tasks).toEqual([]);
    expect(result.outboxMessages).toEqual([]);

    const log = result.logEntries.find((entry) => entry.type === "duplicate_submission");
    expect(log?.metadata?.["mergedFields"]).toEqual([
      "name",
      "phone",
      "email",
      "projectType",
    ]);
  });

  it("still logs a duplicate submission with no incoming data", () => {
    const result = applyAutomationRules(
      makeLead(),
      { type: "duplicate_submission" },
      NOW,
    );

    expect(result.leadChanges).toEqual({
      lastActivity: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(result.logEntries).toEqual([
      expect.objectContaining({ type: "duplicate_submission" }),
    ]);
    expect(result.tasks).toEqual([]);
    expect(result.outboxMessages).toEqual([]);
  });

  it("does not create follow-ups when a won lead receives a duplicate submission", () => {
    const result = applyAutomationRules(
      makeLead({ status: "won" }),
      { type: "duplicate_submission", submission: { notes: "Post-win note" } },
      NOW,
    );

    expect(result.leadChanges.notes).toBe("Post-win note");
    expect(result.tasks).toEqual([]);
    expect(result.outboxMessages).toEqual([]);
  });
});

describe("status updates", () => {
  it("applies a valid transition and updates activity and next action", () => {
    const result = applyAutomationRules(
      makeLead({ status: "new" }),
      { type: "status_changed", status: "qualified" },
      NOW,
    );

    expect(result.leadChanges).toMatchObject({
      status: "qualified",
      lastActivity: NOW_ISO,
      updatedAt: NOW_ISO,
      nextAction: DEFAULT_AUTOMATION_CONFIG.defaultNextActions.qualified,
    });
    expect(result.tasks).toEqual([]);
    expect(result.outboxMessages).toEqual([]);
    expect(result.logEntries).toEqual([
      expect.objectContaining({
        type: "status_changed",
        metadata: expect.objectContaining({ from: "new", to: "qualified" }),
      }),
    ]);
  });

  it("rejects invalid transitions without changing the lead", () => {
    const invalidSkip = applyAutomationRules(
      makeLead({ status: "new" }),
      { type: "status_changed", status: "proposal" },
      NOW,
    );
    const invalidBackward = applyAutomationRules(
      makeLead({ status: "contacted" }),
      { type: "status_changed", status: "new" },
      NOW,
    );
    const invalidSame = applyAutomationRules(
      makeLead({ status: "new" }),
      { type: "status_changed", status: "new" },
      NOW,
    );
    const invalidTarget = applyAutomationRules(
      makeLead({ status: "new" }),
      { type: "status_changed", status: "pending" as LeadStatus },
      NOW,
    );

    for (const result of [invalidSkip, invalidBackward, invalidSame, invalidTarget]) {
      expect(result.leadChanges).toEqual({});
      expect(result.tasks).toEqual([]);
      expect(result.outboxMessages).toEqual([]);
      expect(result.logEntries[0]).toMatchObject({
        type: "other",
        metadata: expect.objectContaining({ code: "invalid_transition" }),
      });
    }
  });

  it("rejects a transition when the current lead status is missing or invalid", () => {
    const missing = applyAutomationRules(
      { id: "lead-1" } as PartialLead,
      { type: "status_changed", status: "qualified" },
      NOW,
    );
    const invalid = applyAutomationRules(
      makeLead({ status: "pending" as LeadStatus }),
      { type: "status_changed", status: "qualified" },
      NOW,
    );

    expect(missing.logEntries[0]?.metadata?.["reason"]).toBe("invalid_current_status");
    expect(invalid.logEntries[0]?.metadata?.["reason"]).toBe("invalid_current_status");
  });

  it("closes open tasks on won or lost and does not add a follow-up", () => {
    const existingTasks = [
      makeTask({ id: "open-follow-up", type: "follow_up" }),
      makeTask({ id: "in-progress", type: "consultation", status: "in_progress" }),
      makeTask({
        id: "overdue",
        type: "follow_up",
        status: "overdue",
        escalatedAt: "2026-11-01T09:00:00.000Z",
      }),
      makeTask({ id: "done", type: "follow_up", status: "done" }),
      makeTask({ id: "cancelled", type: "follow_up", status: "cancelled" }),
    ];

    const won = applyAutomationRules(
      makeLead({ status: "contacted" }),
      { type: "status_changed", status: "won", tasks: existingTasks },
      NOW,
    );
    const lost = applyAutomationRules(
      makeLead({ status: "proposal" }),
      { type: "status_changed", status: "lost", tasks: existingTasks },
      NOW,
    );

    for (const result of [won, lost]) {
      expect(result.leadChanges.status).toBe(won === result ? "won" : "lost");
      expect(result.leadChanges.lastActivity).toBe(NOW_ISO);
      expect(result.tasks.map((task) => task.id)).toEqual([
        "open-follow-up",
        "in-progress",
        "overdue",
      ]);
      expect(result.tasks.every((task) => task.status === "cancelled")).toBe(true);
      expect(result.tasks.every((task) => existingTasks.some((existing) => existing.id === task.id))).toBe(true);
      expect(result.logEntries[0]).toMatchObject({
        type: "status_changed",
        metadata: expect.objectContaining({ closedTaskCount: 3 }),
      });
    }
  });

  it("keeps terminal leads closed unless an explicit reopen is requested", () => {
    const rejected = applyAutomationRules(
      makeLead({ status: "won" }),
      { type: "status_changed", status: "contacted" },
      NOW,
    );
    const reopened = applyAutomationRules(
      makeLead({ status: "won" }),
      { type: "status_changed", status: "contacted", allowReopen: true },
      NOW,
    );

    expect(rejected.leadChanges).toEqual({});
    expect(reopened.leadChanges).toMatchObject({
      status: "contacted",
      lastActivity: NOW_ISO,
    });
    expect(reopened.tasks).toEqual([]);
    expect(reopened.outboxMessages).toEqual([]);
  });

  it("does not create follow-ups when a won lead receives a reassignment", () => {
    const task = makeTask({ id: "open-task", type: "follow_up" });
    const result = applyAutomationRules(
      makeLead({ status: "won", owner: "Priya Nair" }),
      { type: "reassigned", owner: "Rohan Kapoor", tasks: [task] },
      NOW,
    );

    expect(result.leadChanges.owner).toBe("Rohan Kapoor");
    expect(result.tasks.map((updated) => updated.id)).toEqual(["open-task"]);
    expect(result.tasks.every((updated) => updated.id === task.id)).toBe(true);
  });
});

describe("reassignment", () => {
  it("changes owner, notifies both owners, and moves active tasks only", () => {
    const tasks = [
      makeTask({ id: "open", type: "follow_up", assignee: "Priya Nair" }),
      makeTask({
        id: "in-progress",
        type: "consultation",
        status: "in_progress",
        assignee: "Priya Nair",
      }),
      makeTask({
        id: "overdue",
        type: "follow_up",
        status: "overdue",
        assignee: "Priya Nair",
        escalatedAt: "2026-11-01T09:00:00.000Z",
      }),
      makeTask({ id: "already-new", type: "follow_up", assignee: "Rohan Kapoor" }),
      makeTask({ id: "done", type: "follow_up", status: "done", assignee: "Priya Nair" }),
      makeTask({
        id: "cancelled",
        type: "follow_up",
        status: "cancelled",
        assignee: "Priya Nair",
      }),
    ];

    const result = applyAutomationRules(
      makeLead({ owner: "Priya Nair" }),
      { type: "reassigned", owner: "Rohan Kapoor", tasks },
      NOW,
    );

    const notifications = result.outboxMessages.filter(
      (message) => message.kind === "internal_notification",
    );

    expect(result.leadChanges).toMatchObject({
      owner: "Rohan Kapoor",
      lastActivity: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    expect(notifications.map((message) => message.recipient)).toEqual([
      "Rohan Kapoor",
      "Priya Nair",
    ]);
    expect(result.tasks.map((task) => task.id)).toEqual([
      "open",
      "in-progress",
      "overdue",
    ]);
    expect(result.tasks.every((task) => task.assignee === "Rohan Kapoor")).toBe(true);
    expect(result.tasks.find((task) => task.id === "overdue")?.escalatedAt).toBe(
      "2026-11-01T09:00:00.000Z",
    );
    expect(result.tasks.every((task) => tasks.some((existing) => existing.id === task.id))).toBe(true);
    expect(result.logEntries[0]).toMatchObject({
      type: "owner_assigned",
      metadata: expect.objectContaining({
        owner: "Rohan Kapoor",
        previousOwner: "Priya Nair",
      }),
    });
  });

  it("uses an explicit previous owner and notifies only the new owner when none existed", () => {
    const withExplicit = applyAutomationRules(
      makeLead({ owner: undefined }),
      {
        type: "reassigned",
        owner: "Rohan Kapoor",
        previousOwner: "Priya Nair",
      },
      NOW,
    );
    const withNoPrevious = applyAutomationRules(
      makeLead({ owner: undefined }),
      { type: "reassigned", owner: "Rohan Kapoor" },
      NOW,
    );

    expect(
      withExplicit.outboxMessages.filter(
        (message) => message.kind === "internal_notification",
      ),
    ).toHaveLength(2);
    expect(
      withNoPrevious.outboxMessages.filter(
        (message) => message.kind === "internal_notification",
      ),
    ).toHaveLength(1);
  });

  it("ignores a no-op reassignment and an empty owner", () => {
    const sameOwner = applyAutomationRules(
      makeLead({ owner: "Priya Nair" }),
      { type: "reassigned", owner: "Priya Nair" },
      NOW,
    );
    const emptyOwner = applyAutomationRules(
      makeLead({ owner: "Priya Nair" }),
      { type: "reassigned", owner: "   " },
      NOW,
    );

    expect(sameOwner.leadChanges).toEqual({});
    expect(sameOwner.tasks).toEqual([]);
    expect(sameOwner.outboxMessages).toEqual([]);
    expect(sameOwner.logEntries[0]?.metadata?.["code"]).toBe("reassignment_ignored");
    expect(emptyOwner.leadChanges).toEqual({});
    expect(emptyOwner.outboxMessages).toEqual([]);
    expect(emptyOwner.logEntries[0]?.metadata?.["code"]).toBe("invalid_owner");
  });
});

describe("overdue tasks", () => {
  it("marks only due open or in-progress tasks overdue and escalates once each", () => {
    const tasks = [
      makeTask({ id: "due-open", type: "follow_up", assignee: "Priya Nair" }),
      makeTask({
        id: "due-exactly-now",
        type: "consultation",
        status: "in_progress",
        dueAt: NOW_ISO,
        assignee: "Rohan Kapoor",
      }),
      makeTask({
        id: "not-due",
        type: "follow_up",
        dueAt: "2026-11-02T10:00:00.000Z",
      }),
      makeTask({ id: "done", type: "follow_up", status: "done" }),
      makeTask({ id: "cancelled", type: "follow_up", status: "cancelled" }),
      makeTask({ id: "already-overdue", type: "follow_up", status: "overdue" }),
      makeTask({
        id: "already-escalated",
        type: "follow_up",
        escalatedAt: "2026-11-01T09:00:00.000Z",
      }),
      makeTask({ id: "bad-date", type: "follow_up", dueAt: "not-a-date" }),
    ];

    const result = markOverdueTasks(tasks, NOW);

    expect(result.tasks.map((task) => task.id)).toEqual([
      "due-open",
      "due-exactly-now",
    ]);
    expect(result.tasks.every((task) => task.status === "overdue")).toBe(true);
    expect(result.tasks.every((task) => task.escalatedAt === NOW_ISO)).toBe(true);
    expect(result.outboxMessages).toHaveLength(2);
    expect(result.outboxMessages.map((message) => message.recipient)).toEqual([
      "Priya Nair",
      "Rohan Kapoor",
    ]);
    expect(result.outboxMessages.every((message) => message.kind === "internal_notification")).toBe(true);
    expect(result.logEntries).toHaveLength(2);
    expect(result.logEntries.every((entry) => entry.type === "overdue_task")).toBe(true);
  });

  it("is idempotent when updated tasks are applied and evaluated again", () => {
    const tasks = [
      makeTask({ id: "due-open", type: "follow_up" }),
      makeTask({ id: "not-due", type: "follow_up", dueAt: LATER.toISOString() }),
    ];

    const first = markOverdueTasks(tasks, NOW);
    const updates = new Map(first.tasks.map((task) => [task.id, task]));
    const merged = tasks.map((task) => updates.get(task.id) ?? task);
    const second = markOverdueTasks(merged, NOW);

    expect(first.tasks).toHaveLength(1);
    expect(first.outboxMessages).toHaveLength(1);
    expect(first.logEntries).toHaveLength(1);
    expect(second).toEqual({
      tasks: [],
      outboxMessages: [],
      logEntries: [],
    });
  });
});

describe("partial data and purity", () => {
  it("handles a minimal partial lead without crashing", () => {
    const result = applyAutomationRules(
      { id: "partial-lead" } as PartialLead,
      { type: "lead_created" },
      NOW,
    );

    expect(result.leadChanges.status).toBe("new");
    expect(result.tasks.map((task) => task.type).sort()).toEqual([
      "collect_contact_details",
      "follow_up",
    ]);
    expect(
      result.outboxMessages.some((message) => message.kind === "acknowledgement"),
    ).toBe(false);
    expect(result.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "acknowledgement_skipped" }),
      ]),
    );
  });

  it("does not mutate inputs and produces deterministic output for the same fixed clock", () => {
    const lead = Object.freeze(makeLead({ owner: "Priya Nair" }));
    const tasks = Object.freeze([
      Object.freeze(makeTask({ id: "open", type: "follow_up", assignee: "Priya Nair" })),
    ]);
    const event = {
      type: "reassigned" as const,
      owner: "Rohan Kapoor",
      tasks,
    };

    const first = applyAutomationRules(lead, event, NOW);
    const second = applyAutomationRules(lead, event, NOW);

    expect(first).toEqual(second);
    expect(lead.owner).toBe("Priya Nair");
    expect(tasks[0]?.assignee).toBe("Priya Nair");
    expect(first.tasks[0]?.assignee).toBe("Rohan Kapoor");
  });
});
