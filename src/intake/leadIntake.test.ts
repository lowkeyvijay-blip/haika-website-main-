import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActionErrorCode, ActionResult } from "../actions/leadActions";
import { createFixedClock } from "../lib/clock";
import { FileLeadRepository } from "../store/fileLeadStore";
import { DEMO_NOW_ISO, seedDemoData } from "../store/seed";
import type { LeadSource } from "../types/lead";
import { createLeadIntake, type LeadIntake } from "./leadIntake";

let tempDirectory: string;
let repository: FileLeadRepository;
let intake: LeadIntake;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "haika-intake-"));
  repository = new FileLeadRepository({ filePath: join(tempDirectory, "store.json") });
  intake = createLeadIntake({
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
    throw new Error("Expected the intake action to fail.");
  }

  expect(result.error.code).toBe(code);
}

function fullPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "  Ada Lovelace  ",
    phone: "+91 98765-43210",
    email: "  ADA@EXAMPLE.COM ",
    preferredContactMethod: "email",
    enquiryType: "book free design session",
    projectType: "kitchen",
    propertyType: "apartment",
    location: "Pune",
    size: "1200 sq ft",
    budgetRange: "25-40 lakh",
    timeline: "within 1 month",
    notes: "  Interested in a full kitchen refresh.  ",
    ...overrides,
  };
}

describe("submitLead", () => {
  it("normalizes, creates, acknowledges, and attributes a complete website lead", async () => {
    const result = expectOk(await intake.submitLead(fullPayload(), "website form"));
    const lead = await repository.getLead(result.leadId);

    expect(result).toMatchObject({
      outcome: "created",
      acknowledgementQueued: true,
      owner: "Priya Nair",
      status: "qualified",
      flaggedForReview: false,
    });
    expect(lead).toMatchObject({
      name: "Ada Lovelace",
      phone: "+919876543210",
      email: "ada@example.com",
      enquiryType: "book free design session",
      projectType: "kitchen",
      source: "website form",
      status: "qualified",
      owner: "Priya Nair",
      notes: "Interested in a full kitchen refresh.",
      createdAt: DEMO_NOW_ISO,
      updatedAt: DEMO_NOW_ISO,
    });

    const acknowledgements = (await repository.listOutboxMessages(result.leadId)).filter(
      (message) => message.kind === "acknowledgement",
    );
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]?.channel).toBe("email");

    const logs = await repository.listActivityLog(result.leadId);
    expect(logs.some((entry) => entry.type === "status_changed")).toBe(true);
  });

  it("accepts a partial chatbot lead with no contact details", async () => {
    const result = expectOk(
      await intake.submitLead({ name: "Chat Visitor", projectType: "villa" }, "chatbot"),
    );
    const lead = await repository.getLead(result.leadId);
    const tasks = await repository.listTasks(result.leadId);

    expect(result).toMatchObject({
      outcome: "created",
      acknowledgementQueued: false,
      status: "new",
      flaggedForReview: false,
    });
    expect(lead?.email).toBeUndefined();
    expect(lead?.phone).toBeUndefined();
    expect(lead?.nextAction).toBe("Collect contact details.");
    expect(tasks.some((task) => task.type === "collect_contact_details")).toBe(true);
  });

  it("keeps a lead new when qualification data is present but contact details are missing", async () => {
    const result = expectOk(
      await intake.submitLead(
        fullPayload({ phone: undefined, email: undefined }),
        "website form",
      ),
    );
    const lead = await repository.getLead(result.leadId);

    expect(result.acknowledgementQueued).toBe(false);
    expect(lead?.status).toBe("new");
  });

  it("merges a double form submit without creating or acknowledging twice", async () => {
    const first = expectOk(await intake.submitLead(fullPayload(), "website form"));
    const second = expectOk(await intake.submitLead(fullPayload(), "website form"));
    const leads = await repository.listLeads();
    const acknowledgements = (await repository.listOutboxMessages(first.leadId)).filter(
      (message) => message.kind === "acknowledgement",
    );
    const duplicateLogs = (await repository.listActivityLog(first.leadId)).filter(
      (entry) => entry.type === "duplicate_submission",
    );

    expect(second).toMatchObject({
      leadId: first.leadId,
      outcome: "merged",
      acknowledgementQueued: false,
      matchedBy: "phone",
      status: "qualified",
    });
    expect(leads).toHaveLength(1);
    expect(acknowledgements).toHaveLength(1);
    expect(duplicateLogs).toHaveLength(1);
  });

  it("merges the same person from chatbot into a later website form", async () => {
    const chatbot = expectOk(
      await intake.submitLead(
        {
          name: "Ada Lovelace",
          phone: "+91 98765 43210",
          projectType: "kitchen",
        },
        "chatbot",
      ),
    );
    const website = expectOk(
      await intake.submitLead(
        fullPayload({ phone: "+91 (98765) 43210", email: "ada@example.com" }),
        "website form",
      ),
    );
    const lead = await repository.getLead(chatbot.leadId);
    const acknowledgements = (await repository.listOutboxMessages(chatbot.leadId)).filter(
      (message) => message.kind === "acknowledgement",
    );

    expect(chatbot.status).toBe("new");
    expect(website).toMatchObject({
      leadId: chatbot.leadId,
      outcome: "merged",
      acknowledgementQueued: false,
      matchedBy: "phone",
      status: "qualified",
    });
    expect(lead?.source).toBe("chatbot");
    expect(lead?.enquiryType).toBe("book free design session");
    expect(lead?.budgetRange).toBe("25-40 lakh");
    expect(lead?.timeline).toBe("within 1 month");
    expect(acknowledgements).toHaveLength(1);
  });

  it("deduplicates by normalized email when the phone differs", async () => {
    const first = expectOk(
      await intake.submitLead(
        { name: "Ada", email: "ada@example.com", projectType: "kitchen" },
        "chatbot",
      ),
    );
    const second = expectOk(
      await intake.submitLead(
        fullPayload({
          email: " ADA@EXAMPLE.COM ",
          phone: "+91 90000 00000",
        }),
        "website form",
      ),
    );

    expect(second.leadId).toBe(first.leadId);
    expect(second.outcome).toBe("merged");
    expect(second.matchedBy).toBe("email");
  });

  it("logs and flags submissions against won and lost leads without reopening them", async () => {
    await seedDemoData(repository);

    for (const [leadId, phone, status] of [
      ["lead-009", "+91 98330 55667", "won"],
      ["lead-011", "+91 98460 77880", "lost"],
    ] as const) {
      const result = expectOk(
        await intake.submitLead(
          {
            phone,
            budgetRange: "30-40 lakh",
            timeline: "6+ months",
            notes: "Scope changed after close.",
          },
          "website form",
        ),
      );
      const lead = await repository.getLead(leadId);
      const logs = await repository.listActivityLog(leadId);
      const statusChanges = logs.filter((entry) => entry.type === "status_changed");

      expect(result).toMatchObject({
        leadId,
        outcome: "merged",
        acknowledgementQueued: false,
        status,
        flaggedForReview: true,
        reviewReason: "closed_lead",
      });
      expect(lead?.status).toBe(status);
      expect(
        logs.some(
          (entry) =>
            entry.metadata?.["code"] === "closed_lead_review" &&
            entry.metadata?.["status"] === status,
        ),
      ).toBe(true);
      expect(statusChanges.filter((entry) => entry.metadata?.["to"] === "qualified")).toHaveLength(
        0,
      );
    }
  });

  it("rejects invalid sources, payloads, and contact values", async () => {
    expectError(
      await intake.submitLead(fullPayload(), "bogus" as LeadSource),
      "INVALID_INPUT",
    );
    expectError(await intake.submitLead([], "website form"), "INVALID_INPUT");
    expectError(await intake.submitLead({}, "website form"), "INVALID_INPUT");
    expectError(
      await intake.submitLead(fullPayload({ email: "not-an-email" }), "website form"),
      "INVALID_INPUT",
    );
    expectError(
      await intake.submitLead(fullPayload({ phone: "123" }), "website form"),
      "INVALID_INPUT",
    );
  });
});

describe("updateLeadFields", () => {
  it("progresses a partial chatbot lead to qualified as answers arrive", async () => {
    const created = expectOk(
      await intake.submitLead(
        { name: "Chat Visitor", projectType: "villa" },
        "chatbot",
      ),
    );
    const withContact = expectOk(
      await intake.updateLeadFields(created.leadId, {
        phone: "+91 90000 11111",
      }),
    );
    const withBudget = expectOk(
      await intake.updateLeadFields(created.leadId, {
        budgetRange: "1-2 crore",
      }),
    );
    const withTimeline = expectOk(
      await intake.updateLeadFields(created.leadId, {
        timeline: "3-6 months",
      }),
    );
    const lead = await repository.getLead(created.leadId);

    expect(withContact).toMatchObject({
      status: "new",
      updatedFields: ["phone"],
      autoQualified: false,
    });
    expect(withBudget).toMatchObject({
      status: "new",
      autoQualified: false,
    });
    expect(withTimeline).toMatchObject({
      status: "qualified",
      updatedFields: ["timeline"],
      autoQualified: true,
    });
    expect(lead).toMatchObject({
      status: "qualified",
      phone: "+919000011111",
      budgetRange: "1-2 crore",
      timeline: "3-6 months",
      lastActivity: DEMO_NOW_ISO,
    });
  });

  it("updates changed budget and timeline without regressing an already qualified lead", async () => {
    const created = expectOk(await intake.submitLead(fullPayload(), "website form"));
    const result = expectOk(
      await intake.updateLeadFields(created.leadId, {
        budgetRange: "40-60 lakh",
        timeline: "3-6 months",
      }),
    );
    const lead = await repository.getLead(created.leadId);

    expect(result).toMatchObject({
      status: "qualified",
      updatedFields: ["budgetRange", "timeline"],
      autoQualified: false,
    });
    expect(lead?.budgetRange).toBe("40-60 lakh");
    expect(lead?.timeline).toBe("3-6 months");
  });

  it("flags field updates on closed leads without reopening them", async () => {
    await seedDemoData(repository);
    const result = expectOk(
      await intake.updateLeadFields("lead-009", { budgetRange: "50-60 lakh" }),
    );
    const lead = await repository.getLead("lead-009");

    expect(result).toMatchObject({
      status: "won",
      autoQualified: false,
      flaggedForReview: true,
      reviewReason: "closed_lead",
    });
    expect(lead?.status).toBe("won");
  });

  it("rejects invalid ids, missing leads, and invalid partial data", async () => {
    expectError(await intake.updateLeadFields("   ", { name: "Ada" }), "INVALID_INPUT");
    expectError(await intake.updateLeadFields("lead-999", { name: "Ada" }), "NOT_FOUND");
    expectError(
      await intake.updateLeadFields("lead-999", { email: "bad" }),
      "INVALID_INPUT",
    );

    const created = expectOk(await intake.submitLead(fullPayload(), "website form"));

    expectError(await intake.updateLeadFields(created.leadId, {}), "INVALID_INPUT");
    expectError(
      await intake.updateLeadFields(created.leadId, { phone: "123" }),
      "INVALID_INPUT",
    );
  });
});
