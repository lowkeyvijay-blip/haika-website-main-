import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixedClock } from "../lib/clock";
import { computeDuplicateKey, ENQUIRY_TYPES, LEAD_STATUSES } from "../types/lead";
import { FileLeadRepository } from "./fileLeadStore";
import { createSeedState, DEMO_NOW_ISO, resetDemoData, seedDemoData } from "./seed";

let tempDirectory: string;
let filePath: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "haika-seed-"));
  filePath = join(tempDirectory, "demo-store.json");
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("demo seed", () => {
  it("covers the demo statuses, sources, project types, and edge cases", () => {
    const state = createSeedState();
    const findLead = (id: string) => {
      const lead = state.leads.find((candidate) => candidate.id === id);

      if (lead === undefined) {
        throw new Error(`Expected ${id} to exist.`);
      }

      return lead;
    };

    expect(state.leads).toHaveLength(15);
    expect(state.tasks).toHaveLength(8);
    expect(state.outboxMessages).toHaveLength(7);
    expect(state.activityLog).toHaveLength(12);

    expect(new Set(state.leads.map((lead) => lead.status))).toEqual(new Set(LEAD_STATUSES));

    for (const source of ["website form", "chatbot", "referral", "instagram"]) {
      expect(state.leads.some((lead) => lead.source === source)).toBe(true);
    }

    expect(new Set(state.leads.map((lead) => lead.enquiryType))).toEqual(
      new Set(ENQUIRY_TYPES),
    );
    expect(state.leads.every((lead) => lead.enquiryType !== undefined)).toBe(true);

    for (const projectType of ["apartment", "villa", "kitchen", "office"]) {
      expect(state.leads.some((lead) => lead.projectType === projectType)).toBe(true);
    }

    const emailOnly = findLead("lead-001");
    expect(emailOnly.email).toBeDefined();
    expect(emailOnly.phone).toBeUndefined();

    const phoneOnly = findLead("lead-002");
    expect(phoneOnly.phone).toBeDefined();
    expect(phoneOnly.email).toBeUndefined();

    const partial = findLead("lead-013");
    expect(partial.name).toBeUndefined();
    expect(partial.phone).toBeUndefined();
    expect(partial.email).toBeUndefined();

    const duplicateKey = computeDuplicateKey(findLead("lead-014"));
    expect(duplicateKey).not.toBeNull();
    expect(duplicateKey).toBe(computeDuplicateKey(findLead("lead-015")));

    for (const collection of [
      state.leads,
      state.tasks,
      state.outboxMessages,
      state.activityLog,
    ]) {
      expect(new Set(collection.map((record) => record.id)).size).toBe(collection.length);
    }
  });

  it("includes overdue work relative to the pinned demo now", () => {
    const state = createSeedState();
    const now = new Date(DEMO_NOW_ISO).getTime();
    const activePastDue = state.tasks.filter(
      (task) =>
        (task.status === "open" || task.status === "in_progress") &&
        new Date(task.dueAt).getTime() < now,
    );

    expect(activePastDue.length).toBeGreaterThanOrEqual(3);
    expect(
      state.tasks.some((task) => task.status === "overdue" && task.escalatedAt !== undefined),
    ).toBe(true);
  });

  it("writes the full store and can be re-seeded", async () => {
    const repository = new FileLeadRepository({ filePath });

    await seedDemoData(repository);

    expect(await repository.listLeads()).toHaveLength(15);
    expect(await repository.listTasks()).toHaveLength(8);
    expect(await repository.listOutboxMessages()).toHaveLength(7);
    expect(await repository.listActivityLog()).toHaveLength(12);

    const reloaded = new FileLeadRepository({ filePath });
    expect(await reloaded.listLeads()).toHaveLength(15);
  });

  it("resets demo records without touching sibling files", async () => {
    const markerPath = join(tempDirectory, "keep.txt");
    await writeFile(markerPath, "keep", "utf8");

    const repository = new FileLeadRepository({ filePath });
    await seedDemoData(repository);

    const lead = await repository.getLead("lead-001");
    if (lead === undefined) {
      throw new Error("Expected lead-001 to exist.");
    }

    await repository.saveLead({ ...lead, notes: "changed before reset" });
    await resetDemoData(repository);

    expect((await repository.getLead("lead-001"))?.notes).not.toBe("changed before reset");
    expect(await readFile(markerPath, "utf8")).toBe("keep");

    const reloaded = new FileLeadRepository({ filePath });
    expect(await reloaded.listLeads()).toHaveLength(15);
  });

  it("uses an injected clock for seeded timestamps", async () => {
    const repository = new FileLeadRepository({ filePath });
    const clock = createFixedClock("2026-12-15T09:00:00.000Z");

    const state = await seedDemoData(repository, { clock });

    expect(state.tasks.find((task) => task.id === "task-008")?.dueAt).toBe(
      "2026-12-15T07:00:00.000Z",
    );
  });
});
