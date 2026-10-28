import type { ActionResult } from "../actions/leadActions";
import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from "../automation/config";
import {
  applyAutomationRules,
  type AutomationResult,
} from "../automation/rules";
import { shouldAutoQualify } from "../automation/qualification";
import { createSystemClock, type Clock } from "../lib/clock";
import type { LeadRepository } from "../store/leadStore";
import {
  isLeadSource,
  normalizeEmail,
  normalizePhone,
  validateLead,
  type ActivityLogEntry,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type Task,
} from "../types/lead";

const INTAKE_FIELDS = [
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

export type IntakeFieldName = (typeof INTAKE_FIELDS)[number];

export type IntakeOutcome = "created" | "merged";

export type IntakeReviewReason = "closed_lead";

export interface SubmitLeadResult {
  leadId: string;
  outcome: IntakeOutcome;
  acknowledgementQueued: boolean;
  owner?: string;
  status: LeadStatus;
  flaggedForReview: boolean;
  reviewReason?: IntakeReviewReason;
  matchedBy?: "phone" | "email";
}

export interface UpdateLeadFieldsResult {
  leadId: string;
  status: LeadStatus;
  updatedFields: IntakeFieldName[];
  autoQualified: boolean;
  flaggedForReview: boolean;
  reviewReason?: IntakeReviewReason;
}

export interface LeadIntake {
  submitLead(
    payload: unknown,
    source: LeadSource,
  ): Promise<ActionResult<SubmitLeadResult>>;
  updateLeadFields(
    id: string,
    partial: unknown,
  ): Promise<ActionResult<UpdateLeadFieldsResult>>;
}

export interface LeadIntakeDependencies {
  repository: LeadRepository;
  clock?: Clock;
  config?: AutomationConfig;
}

interface NormalizedFields {
  fields: Partial<Lead>;
  names: IntakeFieldName[];
}

type NormalizationResult =
  | { ok: true; value: NormalizedFields }
  | { ok: false; message: string };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail<T>(
  code: "NOT_FOUND" | "INVALID_INPUT",
  message: string,
): ActionResult<T> {
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

function normalizeFields(input: unknown): NormalizationResult {
  if (!isPlainObject(input)) {
    return { ok: false, message: "Lead payload must be an object." };
  }

  const raw: Record<string, unknown> = {};
  for (const field of INTAKE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      raw[field] = input[field];
    }
  }

  const validation = validateLead(raw);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.errors.map((error) => error.message).join(" "),
    };
  }

  const fields: Partial<Lead> = {};
  const fieldRecord = fields as unknown as Record<IntakeFieldName, unknown>;
  const names: IntakeFieldName[] = [];

  for (const field of INTAKE_FIELDS) {
    const value = validation.normalized[field];
    if (value !== undefined) {
      fieldRecord[field] = value;
      names.push(field);
    }
  }

  if (names.length === 0) {
    return { ok: false, message: "At least one lead field is required." };
  }

  return { ok: true, value: { fields, names } };
}

function findDuplicate(
  leads: readonly Lead[],
  fields: Partial<Lead>,
): { lead: Lead; matchedBy: "phone" | "email" } | undefined {
  const phone = normalizePhone(fields.phone);
  if (phone !== null) {
    const match = leads.find((lead) => normalizePhone(lead.phone) === phone);
    if (match !== undefined) {
      return { lead: match, matchedBy: "phone" };
    }
  }

  const email = normalizeEmail(fields.email);
  if (email !== null) {
    const match = leads.find((lead) => normalizeEmail(lead.email) === email);
    if (match !== undefined) {
      return { lead: match, matchedBy: "email" };
    }
  }

  return undefined;
}

function combineResults(
  first: AutomationResult,
  second: AutomationResult,
): AutomationResult {
  return {
    leadChanges: { ...first.leadChanges, ...second.leadChanges },
    tasks: [...first.tasks, ...second.tasks],
    outboxMessages: [...first.outboxMessages, ...second.outboxMessages],
    logEntries: [...first.logEntries, ...second.logEntries],
  };
}

function autoQualification(
  lead: Lead,
  tasks: readonly Task[],
  now: Date,
  config: AutomationConfig,
): AutomationResult | undefined {
  if (!shouldAutoQualify(lead)) {
    return undefined;
  }

  return applyAutomationRules(
    lead,
    { type: "status_changed", status: "qualified", tasks },
    now,
    config,
  );
}

export function createLeadIntake(
  dependencies: LeadIntakeDependencies,
): LeadIntake {
  const { repository } = dependencies;
  const clock = dependencies.clock ?? createSystemClock();
  const config = dependencies.config ?? DEFAULT_AUTOMATION_CONFIG;
  let leadSequence = 0;
  let logSequence = 0;

  function intakeLog(params: {
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
      actor: "intake",
      metadata: params.metadata,
    };
  }

  function nextLeadId(existingIds: ReadonlySet<string>, at: string): string {
    let candidate = "";

    do {
      candidate = `lead:${at}:${++leadSequence}`;
    } while (existingIds.has(candidate));

    return candidate;
  }

  async function persistAutomation(
    baseLead: Lead,
    result: AutomationResult,
    extraLogs: ActivityLogEntry[] = [],
  ): Promise<Lead> {
    const updatedLead: Lead = { ...baseLead, ...result.leadChanges };
    await repository.saveLead(updatedLead);

    for (const task of result.tasks) {
      await repository.saveTask(task);
    }

    for (const message of result.outboxMessages) {
      await repository.saveOutboxMessage(message);
    }

    for (const entry of [...result.logEntries, ...extraLogs]) {
      await repository.saveActivityLogEntry(entry);
    }

    return updatedLead;
  }

  return {
    async submitLead(payload, source) {
      if (!isLeadSource(source)) {
        return fail("INVALID_INPUT", "Lead source is invalid.");
      }

      const normalized = normalizeFields(payload);
      if (!normalized.ok) {
        return fail("INVALID_INPUT", normalized.message);
      }

      const now = clock.now();
      const at = now.toISOString();
      const leads = await repository.listLeads();
      const duplicate = findDuplicate(leads, normalized.value.fields);

      if (duplicate !== undefined) {
        const existing = duplicate.lead;
        const tasks = await repository.listTasks(existing.id);
        const merged = applyAutomationRules(
          existing,
          {
            type: "duplicate_submission",
            submission: normalized.value.fields,
          },
          now,
          config,
        );
        const terminal = existing.status === "won" || existing.status === "lost";
        let combined = merged;

        if (!terminal) {
          const qualification = autoQualification(
            { ...existing, ...merged.leadChanges },
            tasks,
            now,
            config,
          );

          if (qualification !== undefined) {
            combined = combineResults(merged, qualification);
          }
        }

        const extraLogs = terminal
          ? [
              intakeLog({
                leadId: existing.id,
                key: "closed-review",
                type: "other",
                message: `Submission against ${existing.status} lead ${existing.id} flagged for review.`,
                at,
                metadata: {
                  code: "closed_lead_review",
                  status: existing.status,
                  source,
                },
              }),
            ]
          : [];
        const updatedLead = await persistAutomation(existing, combined, extraLogs);

        return ok({
          leadId: existing.id,
          outcome: "merged",
          acknowledgementQueued: false,
          owner: updatedLead.owner,
          status: updatedLead.status,
          flaggedForReview: terminal,
          reviewReason: terminal ? "closed_lead" : undefined,
          matchedBy: duplicate.matchedBy,
        });
      }

      const existingIds = new Set(leads.map((lead) => lead.id));
      const baseLead: Lead = {
        ...normalized.value.fields,
        id: nextLeadId(existingIds, at),
        source,
        status: "new",
        createdAt: at,
        updatedAt: at,
      };
      const created = applyAutomationRules(
        baseLead,
        { type: "lead_created" },
        now,
        config,
      );
      const qualification = autoQualification(
        { ...baseLead, ...created.leadChanges },
        [],
        now,
        config,
      );
      const combined =
        qualification === undefined
          ? created
          : combineResults(created, qualification);
      const updatedLead = await persistAutomation(baseLead, combined);

      return ok({
        leadId: baseLead.id,
        outcome: "created",
        acknowledgementQueued: combined.outboxMessages.some(
          (message) => message.kind === "acknowledgement",
        ),
        owner: updatedLead.owner,
        status: updatedLead.status,
        flaggedForReview: false,
      });
    },

    async updateLeadFields(id, partial) {
      const leadId = cleanId(id);
      if (leadId === undefined) {
        return fail("INVALID_INPUT", "Lead id must be a non-empty string.");
      }

      const normalized = normalizeFields(partial);
      if (!normalized.ok) {
        return fail("INVALID_INPUT", normalized.message);
      }

      const lead = await repository.getLead(leadId);
      if (lead === undefined) {
        return fail("NOT_FOUND", `Lead "${leadId}" was not found.`);
      }

      const now = clock.now();
      const at = now.toISOString();
      const updatedLead: Lead = {
        ...lead,
        ...normalized.value.fields,
        lastActivity: at,
        updatedAt: at,
      };
      await repository.saveLead(updatedLead);
      await repository.saveActivityLogEntry(
        intakeLog({
          leadId,
          key: "fields-updated",
          type: "lead_updated",
          message: `Qualification fields updated (${normalized.value.names.join(", ")}).`,
          at,
          metadata: {
            code: "lead_fields_updated",
            fields: normalized.value.names,
          },
        }),
      );

      const terminal = lead.status === "won" || lead.status === "lost";
      if (terminal) {
        await repository.saveActivityLogEntry(
          intakeLog({
            leadId,
            key: "closed-review",
            type: "other",
            message: `Update to ${lead.status} lead ${leadId} flagged for review.`,
            at,
            metadata: {
              code: "closed_lead_review",
              status: lead.status,
              fields: normalized.value.names,
            },
          }),
        );

        return ok({
          leadId,
          status: lead.status,
          updatedFields: normalized.value.names,
          autoQualified: false,
          flaggedForReview: true,
          reviewReason: "closed_lead",
        });
      }

      const tasks = await repository.listTasks(leadId);
      const qualification = autoQualification(updatedLead, tasks, now, config);
      let finalLead = updatedLead;

      if (qualification !== undefined) {
        finalLead = await persistAutomation(updatedLead, qualification);
      }

      return ok({
        leadId,
        status: finalLead.status,
        updatedFields: normalized.value.names,
        autoQualified: qualification !== undefined,
        flaggedForReview: false,
      });
    },
  };
}
