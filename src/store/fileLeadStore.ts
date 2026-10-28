import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ActivityLogEntry, Lead, OutboxMessage, Task } from "../types/lead";
import {
  emptyLeadStoreState,
  type LeadRepository,
  type LeadStoreState,
} from "./leadStore";

const STORE_VERSION = 1;

export interface FileLeadRepositoryOptions {
  filePath: string;
}

export class StorageCorruptionError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly reason: string,
  ) {
    super(`Demo store at ${filePath} is corrupted: ${reason}`);
    this.name = "StorageCorruptionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function isLeadRecord(value: unknown): value is Lead {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "status") &&
    hasString(value, "source") &&
    hasString(value, "createdAt") &&
    hasString(value, "updatedAt")
  );
}

function isTaskRecord(value: unknown): value is Task {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "leadId") &&
    hasString(value, "type") &&
    hasString(value, "dueAt") &&
    hasString(value, "status") &&
    hasString(value, "assignee")
  );
}

function isOutboxRecord(value: unknown): value is OutboxMessage {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "leadId") &&
    hasString(value, "channel") &&
    hasString(value, "kind") &&
    hasString(value, "recipient") &&
    hasString(value, "body") &&
    hasString(value, "status") &&
    hasString(value, "createdAt")
  );
}

function isActivityRecord(value: unknown): value is ActivityLogEntry {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "leadId") &&
    hasString(value, "type") &&
    hasString(value, "message") &&
    hasString(value, "at")
  );
}

function parseStoreFile(raw: string, filePath: string): LeadStoreState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageCorruptionError(filePath, "file is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new StorageCorruptionError(filePath, "root value must be an object");
  }

  if (parsed["version"] !== STORE_VERSION) {
    throw new StorageCorruptionError(
      filePath,
      `unsupported store version ${String(parsed["version"])}`,
    );
  }

  const leads = parsed["leads"];
  const tasks = parsed["tasks"];
  const outboxMessages = parsed["outboxMessages"];
  const activityLog = parsed["activityLog"];

  if (!Array.isArray(leads) || !leads.every(isLeadRecord)) {
    throw new StorageCorruptionError(filePath, "leads must be valid records");
  }

  if (!Array.isArray(tasks) || !tasks.every(isTaskRecord)) {
    throw new StorageCorruptionError(filePath, "tasks must be valid records");
  }

  if (!Array.isArray(outboxMessages) || !outboxMessages.every(isOutboxRecord)) {
    throw new StorageCorruptionError(filePath, "outboxMessages must be valid records");
  }

  if (!Array.isArray(activityLog) || !activityLog.every(isActivityRecord)) {
    throw new StorageCorruptionError(filePath, "activityLog must be valid records");
  }

  return structuredClone({
    leads,
    tasks,
    outboxMessages,
    activityLog,
  });
}

function assertStoreState(state: LeadStoreState): void {
  if (!Array.isArray(state.leads) || !state.leads.every(isLeadRecord)) {
    throw new TypeError("leads must be valid records");
  }

  if (!Array.isArray(state.tasks) || !state.tasks.every(isTaskRecord)) {
    throw new TypeError("tasks must be valid records");
  }

  if (!Array.isArray(state.outboxMessages) || !state.outboxMessages.every(isOutboxRecord)) {
    throw new TypeError("outboxMessages must be valid records");
  }

  if (!Array.isArray(state.activityLog) || !state.activityLog.every(isActivityRecord)) {
    throw new TypeError("activityLog must be valid records");
  }
}

export class FileLeadRepository implements LeadRepository {
  private readonly filePath: string;
  private state: LeadStoreState | undefined;
  private loadPromise: Promise<void> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private tempSequence = 0;

  constructor(options: FileLeadRepositoryOptions) {
    this.filePath = options.filePath;
  }

  async getLead(id: string): Promise<Lead | undefined> {
    return this.getEntity<Lead>("leads", id);
  }

  async listLeads(): Promise<Lead[]> {
    await this.ensureLoaded();
    return structuredClone(this.requireState().leads);
  }

  async saveLead(lead: Lead): Promise<Lead> {
    return this.saveEntity("leads", lead);
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.getEntity<Task>("tasks", id);
  }

  async listTasks(leadId?: string): Promise<Task[]> {
    await this.ensureLoaded();
    const tasks = this.requireState().tasks;
    return structuredClone(
      leadId === undefined ? tasks : tasks.filter((task) => task.leadId === leadId),
    );
  }

  async saveTask(task: Task): Promise<Task> {
    return this.saveEntity("tasks", task);
  }

  async getOutboxMessage(id: string): Promise<OutboxMessage | undefined> {
    return this.getEntity<OutboxMessage>("outboxMessages", id);
  }

  async listOutboxMessages(leadId?: string): Promise<OutboxMessage[]> {
    await this.ensureLoaded();
    const messages = this.requireState().outboxMessages;
    return structuredClone(
      leadId === undefined
        ? messages
        : messages.filter((message) => message.leadId === leadId),
    );
  }

  async saveOutboxMessage(message: OutboxMessage): Promise<OutboxMessage> {
    return this.saveEntity("outboxMessages", message);
  }

  async getActivityLogEntry(id: string): Promise<ActivityLogEntry | undefined> {
    return this.getEntity<ActivityLogEntry>("activityLog", id);
  }

  async listActivityLog(leadId?: string): Promise<ActivityLogEntry[]> {
    await this.ensureLoaded();
    const entries = this.requireState().activityLog;
    return structuredClone(
      leadId === undefined
        ? entries
        : entries.filter((entry) => entry.leadId === leadId),
    );
  }

  async saveActivityLogEntry(entry: ActivityLogEntry): Promise<ActivityLogEntry> {
    return this.saveEntity("activityLog", entry);
  }

  async replaceAll(state: LeadStoreState): Promise<void> {
    assertStoreState(state);
    this.state = structuredClone(state);
    await this.enqueuePersist();
  }

  private async getEntity<T extends { id: string }>(
    collection: keyof LeadStoreState,
    id: string,
  ): Promise<T | undefined> {
    await this.ensureLoaded();
    const items = this.requireState()[collection] as unknown as T[];
    const found = items.find((item) => item.id === id);
    return found === undefined ? undefined : structuredClone(found);
  }

  private async saveEntity<T extends { id: string }>(
    collection: keyof LeadStoreState,
    item: T,
  ): Promise<T> {
    await this.ensureLoaded();
    const state = this.requireState();
    const items = state[collection] as unknown as T[];
    const index = items.findIndex((existing) => existing.id === item.id);
    const stored = structuredClone(item);

    if (index >= 0) {
      items[index] = stored;
    } else {
      items.push(stored);
    }

    await this.enqueuePersist();
    return structuredClone(stored);
  }

  private requireState(): LeadStoreState {
    if (this.state === undefined) {
      throw new Error("Store state is not loaded.");
    }

    return this.state;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state !== undefined) {
      return;
    }

    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = parseStoreFile(raw, this.filePath);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        this.state = emptyLeadStoreState();
        return;
      }

      throw error;
    }
  }

  private enqueuePersist(): Promise<void> {
    const write = this.writeQueue.then(() => this.persist());
    this.writeQueue = write.catch(() => undefined);
    return write;
  }

  private async persist(): Promise<void> {
    const state = structuredClone(this.requireState());
    await mkdir(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}.${++this.tempSequence}.tmp`;
    const payload = `${JSON.stringify({ version: STORE_VERSION, ...state }, null, 2)}\n`;

    try {
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}
