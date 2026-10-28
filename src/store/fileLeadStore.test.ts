import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActivityLogEntry, Lead, OutboxMessage, Task } from "../types/lead";
import { FileLeadRepository, StorageCorruptionError } from "./fileLeadStore";
import { emptyLeadStoreState } from "./leadStore";

const NOW = "2026-11-02T09:00:00.000Z";

function makeLead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    name: `Lead ${id}`,
    email: `${id}@example.com`,
    source: "website form",
    status: "new",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTask(id: string, leadId: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    leadId,
    type: "follow_up",
    dueAt: NOW,
    status: "open",
    assignee: "Aarav Mehta",
    ...overrides,
  };
}

function makeOutboxMessage(
  id: string,
  leadId: string,
  overrides: Partial<OutboxMessage> = {},
): OutboxMessage {
  return {
    id,
    leadId,
    channel: "email",
    kind: "acknowledgement",
    recipient: "lead@example.com",
    body: "Thanks for your enquiry.",
    status: "queued",
    createdAt: NOW,
    ...overrides,
  };
}

function makeActivityEntry(
  id: string,
  leadId: string,
  overrides: Partial<ActivityLogEntry> = {},
): ActivityLogEntry {
  return {
    id,
    leadId,
    type: "lead_created",
    message: "Lead created.",
    at: NOW,
    ...overrides,
  };
}

let tempDirectory: string;
let filePath: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "haika-file-store-"));
  filePath = join(tempDirectory, "demo-store.json");
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("FileLeadRepository", () => {
  it("starts empty for a missing file and creates the file on first write", async () => {
    const repository = new FileLeadRepository({ filePath });

    expect(await repository.listLeads()).toEqual([]);
    expect(await repository.listTasks()).toEqual([]);
    expect(await repository.listOutboxMessages()).toEqual([]);
    expect(await repository.listActivityLog()).toEqual([]);

    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await repository.saveLead(makeLead("lead-1"));

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ version: 1 });
  });

  it("round-trips every entity type and filters child records by lead", async () => {
    const repository = new FileLeadRepository({ filePath });
    const lead = makeLead("lead-1");
    const task = makeTask("task-1", "lead-1");
    const outboxMessage = makeOutboxMessage("outbox-1", "lead-1");
    const activityEntry = makeActivityEntry("log-1", "lead-1");

    await repository.saveLead(lead);
    await repository.saveTask(task);
    await repository.saveOutboxMessage(outboxMessage);
    await repository.saveActivityLogEntry(activityEntry);

    expect(await repository.getLead("lead-1")).toEqual(lead);
    expect(await repository.getTask("task-1")).toEqual(task);
    expect(await repository.getOutboxMessage("outbox-1")).toEqual(outboxMessage);
    expect(await repository.getActivityLogEntry("log-1")).toEqual(activityEntry);

    expect(await repository.listLeads()).toEqual([lead]);
    expect(await repository.listTasks("lead-1")).toEqual([task]);
    expect(await repository.listTasks("lead-2")).toEqual([]);
    expect(await repository.listOutboxMessages("lead-1")).toEqual([outboxMessage]);
    expect(await repository.listOutboxMessages("lead-2")).toEqual([]);
    expect(await repository.listActivityLog("lead-1")).toEqual([activityEntry]);
    expect(await repository.listActivityLog("lead-2")).toEqual([]);
  });

  it("persists state for a separate repository instance", async () => {
    const repository = new FileLeadRepository({ filePath });
    const lead = makeLead("lead-1", { status: "qualified" });

    await repository.saveLead(lead);

    const reloaded = new FileLeadRepository({ filePath });
    expect(await reloaded.listLeads()).toEqual([lead]);
  });

  it("upserts by id and keeps the latest write", async () => {
    const repository = new FileLeadRepository({ filePath });

    await repository.saveLead(makeLead("lead-1", { notes: "first" }));
    await repository.saveLead(makeLead("lead-1", { notes: "second" }));

    expect(await repository.listLeads()).toHaveLength(1);
    expect((await repository.getLead("lead-1"))?.notes).toBe("second");
  });

  it("does not expose stored records by reference", async () => {
    const repository = new FileLeadRepository({ filePath });
    const lead = makeLead("lead-1");

    await repository.saveLead(lead);
    lead.name = "Changed after save";

    const read = await repository.getLead("lead-1");
    expect(read?.name).toBe("Lead lead-1");

    if (read === undefined) {
      throw new Error("Expected lead to exist.");
    }

    read.name = "Changed read";
    expect((await repository.getLead("lead-1"))?.name).toBe("Lead lead-1");

    const list = await repository.listLeads();
    const listed = list[0];

    if (listed === undefined) {
      throw new Error("Expected lead to exist.");
    }

    listed.name = "Changed list";
    expect((await repository.getLead("lead-1"))?.name).toBe("Lead lead-1");
  });

  it("replaces all collections for seeding", async () => {
    const repository = new FileLeadRepository({ filePath });
    await repository.saveLead(makeLead("old-lead"));

    await repository.replaceAll({
      leads: [makeLead("new-lead")],
      tasks: [makeTask("new-task", "new-lead")],
      outboxMessages: [makeOutboxMessage("new-outbox", "new-lead")],
      activityLog: [makeActivityEntry("new-log", "new-lead")],
    });

    expect((await repository.listLeads()).map((lead) => lead.id)).toEqual(["new-lead"]);

    const reloaded = new FileLeadRepository({ filePath });
    expect(await reloaded.listTasks("new-lead")).toHaveLength(1);
    expect(await reloaded.listOutboxMessages("new-lead")).toHaveLength(1);
    expect(await reloaded.listActivityLog("new-lead")).toHaveLength(1);
  });

  it("creates parent directories for a nested store path", async () => {
    const nestedPath = join(tempDirectory, "nested", "data", "store.json");
    const repository = new FileLeadRepository({ filePath: nestedPath });

    await repository.saveLead(makeLead("lead-1"));

    const reloaded = new FileLeadRepository({ filePath: nestedPath });
    expect(await reloaded.listLeads()).toHaveLength(1);
  });

  it("persists all writes from concurrent-looking saves", async () => {
    const repository = new FileLeadRepository({ filePath });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.saveLead(makeLead(`lead-${index}`)),
      ),
    );

    const reloaded = new FileLeadRepository({ filePath });
    expect((await reloaded.listLeads()).map((lead) => lead.id).sort()).toEqual([
      "lead-0",
      "lead-1",
      "lead-2",
      "lead-3",
      "lead-4",
      "lead-5",
      "lead-6",
      "lead-7",
    ]);
  });

  it("uses last-write-wins semantics across repository instances", async () => {
    const first = new FileLeadRepository({ filePath });
    const second = new FileLeadRepository({ filePath });

    await first.saveLead(makeLead("lead-1", { notes: "first" }));
    await second.saveLead(makeLead("lead-1", { notes: "second" }));

    const reloaded = new FileLeadRepository({ filePath });
    expect((await reloaded.getLead("lead-1"))?.notes).toBe("second");
  });

  it("reports invalid JSON as storage corruption", async () => {
    await writeFile(filePath, "{not valid json", "utf8");
    const repository = new FileLeadRepository({ filePath });

    await expect(repository.listLeads()).rejects.toBeInstanceOf(StorageCorruptionError);
  });

  it("rejects unsupported store versions", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 99,
        leads: [],
        tasks: [],
        outboxMessages: [],
        activityLog: [],
      }),
      "utf8",
    );

    await expect(new FileLeadRepository({ filePath }).listLeads()).rejects.toThrow(
      "unsupported store version 99",
    );
  });

  it("rejects records with missing required fields", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        leads: [{ id: "lead-1" }],
        tasks: [],
        outboxMessages: [],
        activityLog: [],
      }),
      "utf8",
    );

    await expect(new FileLeadRepository({ filePath }).listLeads()).rejects.toThrow(
      "leads must be valid records",
    );
  });

  it("can replace a corrupted file through the reset path", async () => {
    await writeFile(filePath, "{not valid json", "utf8");
    const repository = new FileLeadRepository({ filePath });

    await expect(repository.listLeads()).rejects.toBeInstanceOf(StorageCorruptionError);

    await repository.replaceAll(emptyLeadStoreState());

    const reloaded = new FileLeadRepository({ filePath });
    expect(await reloaded.listLeads()).toEqual([]);
  });
});
