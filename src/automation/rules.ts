import {
  canTransitionLeadStatus,
  isEnquiryType,
  isLeadStatus,
  isPreferredContactMethod,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type ActivityLogEntry,
  type LeadStatus,
  type OutboxChannel,
  type OutboxMessage,
  type PartialLead,
  type Task,
  type TaskType,
} from "../types/lead";
import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from "./config";
import type { LeadAutomationEvent } from "./events";

const HOUR_MS = 60 * 60 * 1000;
const ACTIVE_TASK_STATUSES: readonly Task["status"][] = ["open", "in_progress", "overdue"];
const MERGEABLE_FIELDS = [
  "name",
  "phone",
  "email",
  "preferredContactMethod",
  "enquiryType",
  "projectType",
  "propertyType",
  "location",
  "size",
  "budgetRange",
  "timeline",
  "notes",
] as const;

export interface AutomationResult {
  leadChanges: PartialLead;
  tasks: Task[];
  outboxMessages: OutboxMessage[];
  logEntries: ActivityLogEntry[];
}

export interface OverdueResult {
  tasks: Task[];
  outboxMessages: OutboxMessage[];
  logEntries: ActivityLogEntry[];
}

interface AckTarget {
  channel: OutboxChannel;
  recipient: string;
}

function emptyResult(): AutomationResult {
  return {
    leadChanges: {},
    tasks: [],
    outboxMessages: [],
    logEntries: [],
  };
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function addHoursIso(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * HOUR_MS).toISOString();
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function leadIdOf(lead: PartialLead): string {
  return clean(lead.id) ?? "unknown-lead";
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesAny(value: string | undefined, candidates: readonly string[]): boolean {
  const target = normalized(value);
  return target.length > 0 && candidates.some((candidate) => normalized(candidate) === target);
}

function isActiveTask(task: Task): boolean {
  return ACTIVE_TASK_STATUSES.includes(task.status);
}

function hasActiveTaskOfType(tasks: readonly Task[] | undefined, type: TaskType): boolean {
  return (tasks ?? []).some((task) => task.type === type && isActiveTask(task));
}

function stableIndex(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function resolveRoundRobinIndex(leadId: string, roundRobinIndex?: number): number {
  if (roundRobinIndex !== undefined && Number.isFinite(roundRobinIndex)) {
    return Math.abs(Math.trunc(roundRobinIndex));
  }

  return stableIndex(leadId);
}

export function resolveOwner(
  lead: PartialLead,
  config: AutomationConfig = DEFAULT_AUTOMATION_CONFIG,
  roundRobinIndex?: number,
): string | undefined {
  const existingOwner = clean(lead.owner);
  if (existingOwner !== undefined) {
    return existingOwner;
  }

  for (const rule of config.routingRules) {
    if (rule.projectTypes !== undefined && matchesAny(lead.projectType, rule.projectTypes)) {
      return rule.owner;
    }

    if (rule.locations !== undefined && matchesAny(lead.location, rule.locations)) {
      return rule.owner;
    }
  }

  if (config.team.length === 0) {
    return undefined;
  }

  const index =
    resolveRoundRobinIndex(clean(lead.id) ?? "lead", roundRobinIndex) % config.team.length;

  return config.team[index];
}

export function resolveFollowUpHours(
  lead: PartialLead,
  config: AutomationConfig = DEFAULT_AUTOMATION_CONFIG,
): number {
  if (
    matchesAny(lead.projectType, config.hotProjectTypes) ||
    matchesAny(lead.timeline, config.hotTimelines)
  ) {
    return config.followUpHours.hot;
  }

  if (matchesAny(lead.timeline, config.coldTimelines)) {
    return config.followUpHours.cold;
  }

  return config.followUpHours.standard;
}

function resolveAckTarget(lead: PartialLead): AckTarget | null {
  const phone = normalizePhone(clean(lead.phone));
  const email = normalizeEmail(clean(lead.email));
  const preferred = isPreferredContactMethod(lead.preferredContactMethod)
    ? lead.preferredContactMethod
    : undefined;

  if (preferred === "email" && email !== null) {
    return { channel: "email", recipient: email };
  }

  if (preferred === "phone" && phone !== null) {
    return { channel: "sms", recipient: phone };
  }

  if (preferred === "whatsapp" && phone !== null) {
    return { channel: "whatsapp", recipient: phone };
  }

  if (email !== null) {
    return { channel: "email", recipient: email };
  }

  if (phone !== null) {
    return { channel: "sms", recipient: phone };
  }

  return null;
}

function acknowledgementBody(lead: PartialLead): string {
  const name = clean(lead.name) ?? "there";
  const projectType = clean(lead.projectType);
  const project = projectType === undefined ? "" : ` about your ${projectType} project`;

  return `Hi ${name}, thanks for contacting Haika. We have received your enquiry${project} and a designer will follow up soon.`;
}

function createTask(params: {
  leadId: string;
  type: TaskType;
  dueAt: string;
  assignee: string | undefined;
  at: string;
}): Task {
  return {
    id: `task:${params.leadId}:${params.type}:${params.at}`,
    leadId: params.leadId,
    type: params.type,
    dueAt: params.dueAt,
    status: "open",
    assignee: params.assignee ?? "unassigned",
  };
}

function createOutboxMessage(params: {
  leadId: string;
  key: string;
  channel: OutboxChannel;
  kind: OutboxMessage["kind"];
  recipient: string;
  subject: string | undefined;
  body: string;
  at: string;
}): OutboxMessage {
  return {
    id: `outbox:${params.leadId}:${params.key}:${params.at}`,
    leadId: params.leadId,
    channel: params.channel,
    kind: params.kind,
    recipient: params.recipient,
    subject: params.subject,
    body: params.body,
    status: "queued",
    createdAt: params.at,
  };
}

function createLog(params: {
  leadId: string;
  key: string;
  type: ActivityLogEntry["type"];
  message: string;
  at: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}): ActivityLogEntry {
  return {
    id: `log:${params.leadId}:${params.key}:${params.at}`,
    leadId: params.leadId,
    type: params.type,
    message: params.message,
    at: params.at,
    actor: params.actor ?? "automation",
    metadata: params.metadata,
  };
}

function invalidTransitionResult(
  lead: PartialLead,
  at: string,
  from: unknown,
  to: unknown,
  reason: string,
): AutomationResult {
  return {
    leadChanges: {},
    tasks: [],
    outboxMessages: [],
    logEntries: [
      createLog({
        leadId: leadIdOf(lead),
        key: "status-rejected",
        type: "other",
        message: `Status transition rejected: ${String(from)} -> ${String(to)} (${reason}).`,
        at,
        metadata: {
          code: "invalid_transition",
          from,
          to,
          reason,
        },
      }),
    ],
  };
}

function handleLeadCreated(
  lead: PartialLead,
  event: Extract<LeadAutomationEvent, { type: "lead_created" }>,
  now: Date,
  at: string,
  config: AutomationConfig,
): AutomationResult {
  const result = emptyResult();
  const leadId = leadIdOf(lead);

  let status: LeadStatus;
  if (lead.status === undefined || lead.status === null) {
    status = "new";
    result.leadChanges.status = "new";
  } else if (isLeadStatus(lead.status)) {
    status = lead.status;
  } else {
    result.logEntries.push(
      createLog({
        leadId,
        key: "invalid-lead-status",
        type: "other",
        message: "Automation skipped because the lead has an invalid status.",
        at,
        metadata: { code: "invalid_lead_status", status: lead.status },
      }),
    );
    return result;
  }

  result.leadChanges.lastActivity = at;
  result.leadChanges.updatedAt = at;

  if (status === "won" || status === "lost") {
    result.logEntries.push(
      createLog({
        leadId,
        key: "terminal",
        type: "other",
        message: `Automation skipped for terminal lead status "${status}".`,
        at,
        metadata: { code: "terminal_lead", status },
      }),
    );
    return result;
  }

  let owner = clean(lead.owner);
  if (owner === undefined) {
    owner = resolveOwner(lead, config, event.roundRobinIndex);

    if (owner !== undefined) {
      result.leadChanges.owner = owner;
      result.logEntries.push(
        createLog({
          leadId,
          key: "owner-assigned",
          type: "owner_assigned",
          message: `Lead assigned to ${owner}.`,
          at,
          metadata: {
            code: "owner_assigned",
            owner,
          },
        }),
      );
      result.outboxMessages.push(
        createOutboxMessage({
          leadId,
          key: "assignment",
          channel: "in_app",
          kind: "internal_notification",
          recipient: owner,
          subject: "New lead assigned",
          body: `You have been assigned a new ${status} enquiry from ${clean(lead.name) ?? "a prospect"}.`,
          at,
        }),
      );
    }
  }

  const ackTarget = resolveAckTarget(lead);
  if (ackTarget === null) {
    result.leadChanges.nextAction = config.collectContactDetailsAction;
    result.logEntries.push(
      createLog({
        leadId,
        key: "ack-skipped",
        type: "acknowledgement_skipped",
        message: "Acknowledgement skipped because the lead has no phone or email.",
        at,
        metadata: { code: "no_contact_details" },
      }),
    );

    if (!hasActiveTaskOfType(event.tasks, "collect_contact_details")) {
      const task = createTask({
        leadId,
        type: "collect_contact_details",
        dueAt: addHoursIso(now, config.collectContactDetailsHours),
        assignee: owner,
        at,
      });
      result.tasks.push(task);
      result.logEntries.push(
        createLog({
          leadId,
          key: "collect-contact",
          type: "task_created",
          message: "Collect-contact-details task created.",
          at,
          metadata: { code: "task_created", taskId: task.id, taskType: task.type },
        }),
      );
    }
  } else {
    result.leadChanges.nextAction = config.defaultNextActions[status];
    result.outboxMessages.push(
      createOutboxMessage({
        leadId,
        key: "ack",
        channel: ackTarget.channel,
        kind: "acknowledgement",
        recipient: ackTarget.recipient,
        subject: ackTarget.channel === "email" ? "We received your enquiry" : undefined,
        body: acknowledgementBody(lead),
        at,
      }),
    );
    result.logEntries.push(
      createLog({
        leadId,
        key: "ack",
        type: "outbox_queued",
        message: `Acknowledgement queued via ${ackTarget.channel}.`,
        at,
        metadata: { code: "acknowledgement_queued", channel: ackTarget.channel },
      }),
    );
  }

  if (!hasActiveTaskOfType(event.tasks, "follow_up")) {
    const hours = resolveFollowUpHours(lead, config);
    const task = createTask({
      leadId,
      type: "follow_up",
      dueAt: addHoursIso(now, hours),
      assignee: owner,
      at,
    });
    result.tasks.push(task);
    result.logEntries.push(
      createLog({
        leadId,
        key: "follow-up",
        type: "task_created",
        message: `First follow-up task created with a ${hours}-hour target.`,
        at,
        metadata: { code: "task_created", taskId: task.id, taskType: task.type, hours },
      }),
    );
  }

  return result;
}

function handleDuplicateSubmission(
  lead: PartialLead,
  event: Extract<LeadAutomationEvent, { type: "duplicate_submission" }>,
  at: string,
): AutomationResult {
  const result = emptyResult();
  const leadId = leadIdOf(lead);
  const submission = event.submission ?? {};
  const changes: Record<string, unknown> = {};
  const mergedFields: string[] = [];

  for (const field of MERGEABLE_FIELDS) {
    const raw = submission[field];

    if (field === "preferredContactMethod") {
      if (isPreferredContactMethod(raw)) {
        changes[field] = raw;
        mergedFields.push(field);
      }
      continue;
    }

    if (field === "enquiryType") {
      if (isEnquiryType(raw)) {
        changes[field] = raw;
        mergedFields.push(field);
      }
      continue;
    }

    if (typeof raw !== "string") {
      continue;
    }

    const value = raw.trim();
    if (value.length === 0) {
      continue;
    }

    if (field === "name") {
      const name = normalizeName(value);
      if (name !== undefined) {
        changes[field] = name;
        mergedFields.push(field);
      }
      continue;
    }

    if (field === "phone") {
      const phone = normalizePhone(value);
      if (phone !== null) {
        changes[field] = phone;
        mergedFields.push(field);
      }
      continue;
    }

    if (field === "email") {
      const email = normalizeEmail(value);
      if (email !== null) {
        changes[field] = email;
        mergedFields.push(field);
      }
      continue;
    }

    changes[field] = value;
    mergedFields.push(field);
  }

  changes["lastActivity"] = at;
  changes["updatedAt"] = at;

  result.leadChanges = changes as PartialLead;
  result.logEntries.push(
    createLog({
      leadId,
      key: "duplicate",
      type: "duplicate_submission",
      message:
        mergedFields.length === 0
          ? "Duplicate submission received; no new lead was created."
          : `Duplicate submission merged into the existing lead (${mergedFields.join(", ")}).`,
      at,
      metadata: {
        code: "duplicate_submission",
        mergedFields,
      },
    }),
  );

  return result;
}

function handleStatusChanged(
  lead: PartialLead,
  event: Extract<LeadAutomationEvent, { type: "status_changed" }>,
  at: string,
  config: AutomationConfig,
): AutomationResult {
  const leadId = leadIdOf(lead);
  const from = lead.status;

  if (!isLeadStatus(from)) {
    return invalidTransitionResult(lead, at, from, event.status, "invalid_current_status");
  }

  if (!isLeadStatus(event.status)) {
    return invalidTransitionResult(lead, at, from, event.status, "invalid_target_status");
  }

  if (!canTransitionLeadStatus(from, event.status, { allowReopen: event.allowReopen })) {
    return invalidTransitionResult(lead, at, from, event.status, "not_allowed");
  }

  const result = emptyResult();
  result.leadChanges.status = event.status;
  result.leadChanges.lastActivity = at;
  result.leadChanges.updatedAt = at;
  result.leadChanges.nextAction = config.defaultNextActions[event.status];

  const closedTasks: Task[] = [];
  if (event.status === "won" || event.status === "lost") {
    for (const task of event.tasks ?? []) {
      if (!isActiveTask(task)) {
        continue;
      }

      closedTasks.push({ ...task, status: "cancelled" });
    }
  }

  result.logEntries.push(
    createLog({
      leadId,
      key: "status",
      type: "status_changed",
      message: `Lead status changed from ${from} to ${event.status}.`,
      at,
      metadata: {
        code: "status_changed",
        from,
        to: event.status,
        closedTaskCount: closedTasks.length,
      },
    }),
  );

  for (const task of closedTasks) {
    result.tasks.push(task);
    result.logEntries.push(
      createLog({
        leadId,
        key: `task-closed-${task.id}`,
        type: "task_updated",
        message: `Task ${task.id} cancelled because the lead is ${event.status}.`,
        at,
        metadata: { code: "task_cancelled", taskId: task.id, from: task.status, to: "cancelled" },
      }),
    );
  }

  return result;
}

function handleReassigned(
  lead: PartialLead,
  event: Extract<LeadAutomationEvent, { type: "reassigned" }>,
  at: string,
): AutomationResult {
  const result = emptyResult();
  const leadId = leadIdOf(lead);
  const nextOwner = clean(event.owner);
  const previousOwner = clean(event.previousOwner) ?? clean(lead.owner);

  if (nextOwner === undefined) {
    result.logEntries.push(
      createLog({
        leadId,
        key: "invalid-owner",
        type: "other",
        message: "Reassignment skipped because the new owner was empty.",
        at,
        metadata: { code: "invalid_owner" },
      }),
    );
    return result;
  }

  if (nextOwner === previousOwner) {
    result.logEntries.push(
      createLog({
        leadId,
        key: "reassignment-ignored",
        type: "other",
        message: `Reassignment ignored because ${nextOwner} already owns the lead.`,
        at,
        metadata: { code: "reassignment_ignored", owner: nextOwner },
      }),
    );
    return result;
  }

  result.leadChanges.owner = nextOwner;
  result.leadChanges.lastActivity = at;
  result.leadChanges.updatedAt = at;

  result.logEntries.push(
    createLog({
      leadId,
      key: "reassigned",
      type: "owner_assigned",
      message: `Lead reassigned to ${nextOwner}.`,
      at,
      metadata: { code: "owner_reassigned", owner: nextOwner, previousOwner },
    }),
  );

  result.outboxMessages.push(
    createOutboxMessage({
      leadId,
      key: "reassignment-new",
      channel: "in_app",
      kind: "internal_notification",
      recipient: nextOwner,
      subject: "Lead reassigned to you",
      body: `Lead ${leadId} has been reassigned to you.`,
      at,
    }),
  );

  if (previousOwner !== undefined) {
    result.outboxMessages.push(
      createOutboxMessage({
        leadId,
        key: "reassignment-previous",
        channel: "in_app",
        kind: "internal_notification",
        recipient: previousOwner,
        subject: "Lead reassigned away",
        body: `Lead ${leadId} has been reassigned from you to ${nextOwner}.`,
        at,
      }),
    );
  }

  for (const task of event.tasks ?? []) {
    if (!isActiveTask(task) || task.assignee === nextOwner) {
      continue;
    }

    result.tasks.push({ ...task, assignee: nextOwner });
    result.logEntries.push(
      createLog({
        leadId,
        key: `task-moved-${task.id}`,
        type: "task_updated",
        message: `Task ${task.id} moved to ${nextOwner}.`,
        at,
        metadata: {
          code: "task_reassigned",
          taskId: task.id,
          from: task.assignee,
          to: nextOwner,
        },
      }),
    );
  }

  return result;
}

export function applyAutomationRules(
  lead: PartialLead,
  event: LeadAutomationEvent,
  now: Date,
  config: AutomationConfig = DEFAULT_AUTOMATION_CONFIG,
): AutomationResult {
  const at = nowIso(now);

  switch (event.type) {
    case "lead_created":
      return handleLeadCreated(lead, event, now, at, config);
    case "duplicate_submission":
      return handleDuplicateSubmission(lead, event, at);
    case "status_changed":
      return handleStatusChanged(lead, event, at, config);
    case "reassigned":
      return handleReassigned(lead, event, at);
    default: {
      const unsupported = event as { type?: unknown };
      return {
        leadChanges: {},
        tasks: [],
        outboxMessages: [],
        logEntries: [
          createLog({
            leadId: leadIdOf(lead),
            key: "unsupported",
            type: "other",
            message: `Unsupported automation event: ${String(unsupported.type)}.`,
            at,
            metadata: { code: "unsupported_event" },
          }),
        ],
      };
    }
  }
}

export function markOverdueTasks(tasks: readonly Task[], now: Date): OverdueResult {
  const at = nowIso(now);
  const result: OverdueResult = {
    tasks: [],
    outboxMessages: [],
    logEntries: [],
  };

  for (const task of tasks) {
    if (task.status !== "open" && task.status !== "in_progress") {
      continue;
    }

    if (task.escalatedAt !== undefined) {
      continue;
    }

    const dueAt = new Date(task.dueAt);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() > now.getTime()) {
      continue;
    }

    result.tasks.push({
      ...task,
      status: "overdue",
      escalatedAt: at,
    });

    result.outboxMessages.push(
      createOutboxMessage({
        leadId: task.leadId,
        key: `overdue-${task.id}`,
        channel: "in_app",
        kind: "internal_notification",
        recipient: clean(task.assignee) ?? "unassigned",
        subject: "Overdue follow-up",
        body: `Task ${task.id} for lead ${task.leadId} is overdue.`,
        at,
      }),
    );

    result.logEntries.push(
      createLog({
        leadId: task.leadId,
        key: `overdue-${task.id}`,
        type: "overdue_task",
        message: `Task ${task.id} became overdue.`,
        at,
        metadata: {
          code: "task_overdue",
          taskId: task.id,
          dueAt: task.dueAt,
          assignee: task.assignee,
        },
      }),
    );
  }

  return result;
}
