import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from "../automation/config";
import {
  applyAutomationRules,
  markOverdueTasks,
  type AutomationResult,
  type OverdueResult,
} from "../automation/rules";
import { createSystemClock, type Clock } from "../lib/clock";
import type { LeadRepository } from "../store/leadStore";
import {
  LEAD_STATUSES,
  canTransitionLeadStatus,
  isLeadSource,
  isLeadStatus,
  normalizeEmail,
  normalizePhone,
  type ActivityLogEntry,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type OutboxMessage,
  type Task,
} from "../types/lead";

export const ACTION_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "INVALID_INPUT",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export interface ActionError {
  code: ActionErrorCode;
  message: string;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export interface LeadFilters {
  status?: LeadStatus;
  owner?: string;
  overdue?: boolean;
  source?: LeadSource;
  search?: string;
}

export interface LeadDetail {
  lead: Lead;
  tasks: Task[];
  outboxMessages: OutboxMessage[];
  activityLog: ActivityLogEntry[];
}

export interface DashboardSummary {
  totalLeads: number;
  byStatus: Record<LeadStatus, number>;
  overdue: number;
  withoutContactDetails: number;
  unassigned: number;
}

export interface LeadActions {
  listLeads(filters?: LeadFilters): Promise<ActionResult<Lead[]>>;
  getLead(id: string): Promise<ActionResult<LeadDetail>>;
  updateStatus(
    id: string,
    status: LeadStatus,
    note?: string,
  ): Promise<ActionResult<LeadDetail>>;
  reassign(id: string, owner: string): Promise<ActionResult<LeadDetail>>;
  completeTask(taskId: string): Promise<ActionResult<Task>>;
  addNote(id: string, text: string): Promise<ActionResult<ActivityLogEntry>>;
  runOverdueCheck(now?: Date): Promise<ActionResult<OverdueResult>>;
  getDashboardSummary(): Promise<ActionResult<DashboardSummary>>;
}

export interface LeadActionDependencies {
  repository: LeadRepository;
  clock?: Clock;
  config?: AutomationConfig;
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail<T>(code: ActionErrorCode, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function searchableText(lead: Lead): string {
  return [
    lead.id,
    lead.name,
    lead.phone,
    lead.email,
    lead.enquiryType,
    lead.projectType,
    lead.propertyType,
    lead.location,
    lead.size,
    lead.budgetRange,
    lead.timeline,
    lead.source,
    lead.status,
    lead.owner,
    lead.nextAction,
    lead.notes,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function isOverdueTask(task: Task, now: Date): boolean {
  if (task.status === "overdue") {
    return true;
  }

  if (task.status !== "open" && task.status !== "in_progress") {
    return false;
  }

  const dueAt = Date.parse(task.dueAt);
  return !Number.isNaN(dueAt) && dueAt <= now.getTime();
}

function overdueLeadIds(tasks: readonly Task[], now: Date): Set<string> {
  const ids = new Set<string>();

  for (const task of tasks) {
    if (isOverdueTask(task, now)) {
      ids.add(task.leadId);
    }
  }

  return ids;
}

function validateFilters(filters: LeadFilters | undefined): ActionError | undefined {
  if (filters === undefined) {
    return undefined;
  }

  if (!isPlainObject(filters)) {
    return { code: "INVALID_INPUT", message: "Filters must be an object." };
  }

  if (filters.status !== undefined && !isLeadStatus(filters.status)) {
    return { code: "INVALID_INPUT", message: "Status filter is invalid." };
  }

  if (filters.source !== undefined && !isLeadSource(filters.source)) {
    return { code: "INVALID_INPUT", message: "Source filter is invalid." };
  }

  if (
    filters.owner !== undefined &&
    (typeof filters.owner !== "string" || filters.owner.trim().length === 0)
  ) {
    return { code: "INVALID_INPUT", message: "Owner filter must be a non-empty string." };
  }

  if (filters.overdue !== undefined && typeof filters.overdue !== "boolean") {
    return { code: "INVALID_INPUT", message: "Overdue filter must be a boolean." };
  }

  if (filters.search !== undefined && typeof filters.search !== "string") {
    return { code: "INVALID_INPUT", message: "Search filter must be a string." };
  }

  return undefined;
}

export function createLeadActions(
  dependencies: LeadActionDependencies,
): LeadActions {
  const { repository } = dependencies;
  const clock = dependencies.clock ?? createSystemClock();
  const config = dependencies.config ?? DEFAULT_AUTOMATION_CONFIG;
  let logSequence = 0;

  function actionLog(params: {
    leadId: string;
    key: string;
    type: ActivityLogEntry["type"];
    message: string;
    at: string;
    metadata?: Record<string, unknown>;
  }): ActivityLogEntry {
    return {
      id: `log:${params.leadId}:${params.key}:${params.at}:${++logSequence}`,
      leadId: params.leadId,
      type: params.type,
      message: params.message,
      at: params.at,
      actor: "dashboard",
      metadata: params.metadata,
    };
  }

  async function loadDetail(id: string): Promise<LeadDetail | undefined> {
    const lead = await repository.getLead(id);
    if (lead === undefined) {
      return undefined;
    }

    const [tasks, outboxMessages, activityLog] = await Promise.all([
      repository.listTasks(id),
      repository.listOutboxMessages(id),
      repository.listActivityLog(id),
    ]);

    return { lead, tasks, outboxMessages, activityLog };
  }

  async function persistAutomation(
    lead: Lead,
    result: AutomationResult,
  ): Promise<Lead> {
    const updatedLead: Lead = { ...lead, ...result.leadChanges };
    await repository.saveLead(updatedLead);

    for (const task of result.tasks) {
      await repository.saveTask(task);
    }

    for (const message of result.outboxMessages) {
      await repository.saveOutboxMessage(message);
    }

    for (const entry of result.logEntries) {
      await repository.saveActivityLogEntry(entry);
    }

    return updatedLead;
  }

  return {
    async listLeads(filters) {
      const filterError = validateFilters(filters);
      if (filterError !== undefined) {
        return fail(filterError.code, filterError.message);
      }

      const leads = await repository.listLeads();
      const status = filters?.status;
      const owner = normalized(filters?.owner);
      const source = filters?.source;
      const search = normalized(filters?.search);
      let overdueIds: Set<string> | undefined;

      if (filters?.overdue !== undefined) {
        overdueIds = overdueLeadIds(await repository.listTasks(), clock.now());
      }

      const result = leads.filter((lead) => {
        if (status !== undefined && lead.status !== status) {
          return false;
        }

        if (owner.length > 0 && normalized(lead.owner) !== owner) {
          return false;
        }

        if (source !== undefined && lead.source !== source) {
          return false;
        }

        if (search.length > 0 && !searchableText(lead).includes(search)) {
          return false;
        }

        if (filters?.overdue !== undefined && overdueIds !== undefined) {
          const isOverdue = overdueIds.has(lead.id);
          if (isOverdue !== filters.overdue) {
            return false;
          }
        }

        return true;
      });

      return ok(result);
    },

    async getLead(id) {
      const leadId = cleanId(id);
      if (leadId === undefined) {
        return fail("INVALID_INPUT", "Lead id must be a non-empty string.");
      }

      const detail = await loadDetail(leadId);
      if (detail === undefined) {
        return fail("NOT_FOUND", `Lead "${leadId}" was not found.`);
      }

      return ok(detail);
    },

    async updateStatus(id, status, note) {
      const leadId = cleanId(id);
      if (leadId === undefined) {
        return fail("INVALID_INPUT", "Lead id must be a non-empty string.");
      }

      if (!isLeadStatus(status)) {
        return fail("INVALID_INPUT", "Target status is invalid.");
      }

      if (note !== undefined && typeof note !== "string") {
        return fail("INVALID_INPUT", "Status note must be a string.");
      }

      const lead = await repository.getLead(leadId);
      if (lead === undefined) {
        return fail("NOT_FOUND", `Lead "${leadId}" was not found.`);
      }

      if (!canTransitionLeadStatus(lead.status, status)) {
        const terminal = lead.status === "won" || lead.status === "lost";
        return fail(
          "INVALID_TRANSITION",
          `Cannot change status from "${lead.status}" to "${status}"${terminal ? " because the lead is closed" : ""}.`,
        );
      }

      const now = clock.now();
      const tasks = await repository.listTasks(leadId);
      const result = applyAutomationRules(
        lead,
        { type: "status_changed", status, tasks },
        now,
        config,
      );
      await persistAutomation(lead, result);

      const noteText = note?.trim();
      if (noteText !== undefined && noteText.length > 0) {
        const at = now.toISOString();
        await repository.saveActivityLogEntry(
          actionLog({
            leadId,
            key: "status-note",
            type: "note_added",
            message: noteText,
            at,
            metadata: {
              code: "status_note",
              from: lead.status,
              to: status,
            },
          }),
        );
      }

      const detail = await loadDetail(leadId);
      if (detail === undefined) {
        throw new Error(`Lead "${leadId}" disappeared after an update.`);
      }

      return ok(detail);
    },

    async reassign(id, owner) {
      const leadId = cleanId(id);
      if (leadId === undefined) {
        return fail("INVALID_INPUT", "Lead id must be a non-empty string.");
      }

      const nextOwner = typeof owner === "string" ? owner.trim() : "";
      if (nextOwner.length === 0) {
        return fail("INVALID_INPUT", "Owner must be a non-empty string.");
      }

      const lead = await repository.getLead(leadId);
      if (lead === undefined) {
        return fail("NOT_FOUND", `Lead "${leadId}" was not found.`);
      }

      if (normalized(lead.owner) === normalized(nextOwner)) {
        const detail = await loadDetail(leadId);
        if (detail === undefined) {
          throw new Error(`Lead "${leadId}" disappeared after a reassignment.`);
        }

        return ok(detail);
      }

      const tasks = await repository.listTasks(leadId);
      const result = applyAutomationRules(
        lead,
        { type: "reassigned", owner: nextOwner, previousOwner: lead.owner, tasks },
        clock.now(),
        config,
      );
      await persistAutomation(lead, result);

      const detail = await loadDetail(leadId);
      if (detail === undefined) {
        throw new Error(`Lead "${leadId}" disappeared after a reassignment.`);
      }

      return ok(detail);
    },

    async completeTask(taskId) {
      const id = cleanId(taskId);
      if (id === undefined) {
        return fail("INVALID_INPUT", "Task id must be a non-empty string.");
      }

      const task = await repository.getTask(id);
      if (task === undefined) {
        return fail("NOT_FOUND", `Task "${id}" was not found.`);
      }

      if (task.status === "done") {
        return ok(task);
      }

      if (task.status === "cancelled") {
        return fail("INVALID_INPUT", "Cancelled tasks cannot be completed.");
      }

      const at = clock.now().toISOString();
      const updatedTask: Task = { ...task, status: "done" };
      await repository.saveTask(updatedTask);

      const lead = await repository.getLead(task.leadId);
      if (lead !== undefined) {
        await repository.saveLead({
          ...lead,
          lastActivity: at,
          updatedAt: at,
        });
      }

      await repository.saveActivityLogEntry(
        actionLog({
          leadId: task.leadId,
          key: `task-completed-${task.id}`,
          type: "task_completed",
          message: `Task ${task.id} completed.`,
          at,
          metadata: {
            code: "task_completed",
            taskId: task.id,
            from: task.status,
            to: "done",
          },
        }),
      );

      return ok(updatedTask);
    },

    async addNote(id, text) {
      const leadId = cleanId(id);
      if (leadId === undefined) {
        return fail("INVALID_INPUT", "Lead id must be a non-empty string.");
      }

      const noteText = typeof text === "string" ? text.trim() : "";
      if (noteText.length === 0) {
        return fail("INVALID_INPUT", "Note text must be a non-empty string.");
      }

      const lead = await repository.getLead(leadId);
      if (lead === undefined) {
        return fail("NOT_FOUND", `Lead "${leadId}" was not found.`);
      }

      const at = clock.now().toISOString();
      const existingNotes = lead.notes?.trim();
      await repository.saveLead({
        ...lead,
        notes:
          existingNotes === undefined || existingNotes.length === 0
            ? noteText
            : `${existingNotes}\n${noteText}`,
        lastActivity: at,
        updatedAt: at,
      });

      const entry = actionLog({
        leadId,
        key: "note",
        type: "note_added",
        message: noteText,
        at,
        metadata: { code: "note_added" },
      });
      await repository.saveActivityLogEntry(entry);

      return ok(entry);
    },

    async runOverdueCheck(now) {
      let checkDate: Date;

      if (now === undefined) {
        checkDate = clock.now();
      } else if (now instanceof Date && !Number.isNaN(now.getTime())) {
        checkDate = new Date(now.getTime());
      } else {
        return fail("INVALID_INPUT", "Overdue check time must be a valid Date.");
      }

      const tasks = await repository.listTasks();
      const result = markOverdueTasks(tasks, checkDate);

      for (const task of result.tasks) {
        await repository.saveTask(task);
      }

      for (const message of result.outboxMessages) {
        await repository.saveOutboxMessage(message);
      }

      for (const entry of result.logEntries) {
        await repository.saveActivityLogEntry(entry);
      }

      return ok(result);
    },

    async getDashboardSummary() {
      const [leads, tasks] = await Promise.all([
        repository.listLeads(),
        repository.listTasks(),
      ]);
      const byStatus = Object.fromEntries(
        LEAD_STATUSES.map((status) => [status, 0]),
      ) as Record<LeadStatus, number>;

      for (const lead of leads) {
        if (isLeadStatus(lead.status)) {
          byStatus[lead.status] += 1;
        }
      }

      const overdueIds = overdueLeadIds(tasks, clock.now());

      return ok({
        totalLeads: leads.length,
        byStatus,
        overdue: leads.filter((lead) => overdueIds.has(lead.id)).length,
        withoutContactDetails: leads.filter(
          (lead) =>
            normalizePhone(lead.phone) === null &&
            normalizeEmail(lead.email) === null,
        ).length,
        unassigned: leads.filter(
          (lead) =>
            typeof lead.owner !== "string" || lead.owner.trim().length === 0,
        ).length,
      });
    },
  };
}
