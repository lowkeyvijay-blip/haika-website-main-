export const LEAD_STATUSES = [
  "new",
  "qualified",
  "contacted",
  "consultation booked",
  "proposal",
  "won",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "website form",
  "chatbot",
  "campaign",
  "referral",
  "instagram",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const PREFERRED_CONTACT_METHODS = ["phone", "email", "whatsapp"] as const;

export type PreferredContactMethod = (typeof PREFERRED_CONTACT_METHODS)[number];

export const ENQUIRY_TYPES = [
  "meet a designer",
  "book free design session",
  "get free estimate",
] as const;

export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

export const TASK_TYPES = [
  "acknowledgement",
  "follow_up",
  "collect_contact_details",
  "consultation",
  "proposal",
  "other",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["open", "in_progress", "overdue", "done", "cancelled"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OUTBOX_CHANNELS = ["email", "whatsapp", "sms", "in_app"] as const;

export type OutboxChannel = (typeof OUTBOX_CHANNELS)[number];

export const OUTBOX_KINDS = ["acknowledgement", "internal_notification"] as const;

export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const OUTBOX_STATUSES = ["queued", "sent", "failed"] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "lead_created",
  "lead_updated",
  "status_changed",
  "task_created",
  "task_completed",
  "task_updated",
  "outbox_queued",
  "owner_assigned",
  "duplicate_submission",
  "acknowledgement_skipped",
  "overdue_task",
  "note_added",
  "other",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface Lead {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  preferredContactMethod?: PreferredContactMethod;
  enquiryType?: EnquiryType;
  projectType?: string;
  propertyType?: string;
  location?: string;
  size?: string;
  budgetRange?: string;
  timeline?: string;
  source: LeadSource;
  status: LeadStatus;
  owner?: string;
  nextAction?: string;
  lastActivity?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PartialLead = Partial<Lead>;

export interface Task {
  id: string;
  leadId: string;
  type: TaskType;
  dueAt: string;
  status: TaskStatus;
  assignee: string;
  escalatedAt?: string;
}

export interface OutboxMessage {
  id: string;
  leadId: string;
  channel: OutboxChannel;
  kind: OutboxKind;
  recipient: string;
  subject?: string;
  body: string;
  status: OutboxStatus;
  createdAt: string;
  sentAt?: string;
}

export interface ActivityLogEntry {
  id: string;
  leadId: string;
  type: ActivityType;
  message: string;
  at: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export const LEAD_STATUS_TRANSITIONS: Readonly<
  Record<LeadStatus, readonly LeadStatus[]>
> = {
  new: ["qualified", "contacted", "lost"],
  qualified: ["contacted", "consultation booked", "lost"],
  contacted: ["consultation booked", "proposal", "won", "lost"],
  "consultation booked": ["proposal", "won", "lost"],
  proposal: ["won", "lost"],
  won: [],
  lost: [],
};

export const REOPEN_STATUSES = ["contacted", "qualified"] as const satisfies readonly LeadStatus[];

export type LeadValidationField = keyof Lead | "contactDetails" | "root";

export type LeadContactStatus = "present" | "missing" | "invalid";

export interface LeadValidationIssue {
  field: LeadValidationField;
  code: string;
  message: string;
}

export type LeadDuplicateKey = `phone:${string}` | `email:${string}`;

export interface LeadValidationResult {
  ok: boolean;
  contactStatus: LeadContactStatus;
  errors: LeadValidationIssue[];
  warnings: LeadValidationIssue[];
  normalized: PartialLead;
  duplicateKey: LeadDuplicateKey | null;
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && (LEAD_SOURCES as readonly string[]).includes(value);
}

export function isPreferredContactMethod(value: unknown): value is PreferredContactMethod {
  return (
    typeof value === "string" &&
    (PREFERRED_CONTACT_METHODS as readonly string[]).includes(value)
  );
}

export function isEnquiryType(value: unknown): value is EnquiryType {
  return (
    typeof value === "string" &&
    (ENQUIRY_TYPES as readonly string[]).includes(value)
  );
}

export function canTransitionLeadStatus(
  from: unknown,
  to: unknown,
  options: { allowReopen?: boolean } = {},
): boolean {
  if (!isLeadStatus(from) || !isLeadStatus(to) || from === to) {
    return false;
  }

  if (from === "won" || from === "lost") {
    return (
      options.allowReopen === true &&
      (REOPEN_STATUSES as readonly LeadStatus[]).includes(to)
    );
  }

  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}

export function normalizeName(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const cleaned = trimmed.replace(/[\s().-]/g, "");
  return /^\+?\d{7,15}$/.test(cleaned) ? cleaned : null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function computeDuplicateKey(contact: {
  phone?: string | null;
  email?: string | null;
}): LeadDuplicateKey | null {
  const phone = normalizePhone(contact.phone);
  if (phone !== null) {
    return `phone:${phone}`;
  }

  const email = normalizeEmail(contact.email);
  if (email !== null) {
    return `email:${email}`;
  }

  return null;
}

const STRING_FIELDS = [
  "id",
  "name",
  "phone",
  "email",
  "projectType",
  "propertyType",
  "location",
  "size",
  "budgetRange",
  "timeline",
  "owner",
  "nextAction",
  "lastActivity",
  "notes",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Lead)[];

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  return input as Record<string, unknown>;
}

export function validateLead(input: unknown): LeadValidationResult {
  const errors: LeadValidationIssue[] = [];
  const warnings: LeadValidationIssue[] = [];
  const normalizedRecord: Record<string, unknown> = {};
  const record = asRecord(input);

  if (record === null) {
    return {
      ok: false,
      contactStatus: "missing",
      errors: [
        {
          field: "root",
          code: "invalid_lead",
          message: "Lead must be an object.",
        },
      ],
      warnings,
      normalized: {},
      duplicateKey: null,
    };
  }

  for (const field of STRING_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value !== "string") {
      errors.push({
        field,
        code: "invalid_type",
        message: `${field} must be a string.`,
      });
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      normalizedRecord[field] = trimmed;
    }
  }

  const status = record["status"];
  if (status !== undefined && status !== null) {
    if (isLeadStatus(status)) {
      normalizedRecord["status"] = status;
    } else {
      errors.push({
        field: "status",
        code: "invalid_status",
        message: `Status must be one of: ${LEAD_STATUSES.join(", ")}.`,
      });
    }
  }

  const source = record["source"];
  if (source !== undefined && source !== null) {
    if (isLeadSource(source)) {
      normalizedRecord["source"] = source;
    } else {
      errors.push({
        field: "source",
        code: "invalid_source",
        message: `Source must be one of: ${LEAD_SOURCES.join(", ")}.`,
      });
    }
  }

  const preferredContactMethod = record["preferredContactMethod"];
  if (preferredContactMethod !== undefined && preferredContactMethod !== null) {
    if (isPreferredContactMethod(preferredContactMethod)) {
      normalizedRecord["preferredContactMethod"] = preferredContactMethod;
    } else {
      errors.push({
        field: "preferredContactMethod",
        code: "invalid_preferred_contact_method",
        message: `Preferred contact method must be one of: ${PREFERRED_CONTACT_METHODS.join(", ")}.`,
      });
    }
  }

  const enquiryType = record["enquiryType"];
  if (enquiryType !== undefined && enquiryType !== null) {
    if (isEnquiryType(enquiryType)) {
      normalizedRecord["enquiryType"] = enquiryType;
    } else {
      errors.push({
        field: "enquiryType",
        code: "invalid_enquiry_type",
        message: `Enquiry type must be one of: ${ENQUIRY_TYPES.join(", ")}.`,
      });
    }
  }

  const phoneInput = record["phone"];
  const emailInput = record["email"];
  const phoneText = typeof phoneInput === "string" ? phoneInput.trim() : "";
  const emailText = typeof emailInput === "string" ? emailInput.trim() : "";
  const hasContactInput =
    phoneText.length > 0 ||
    emailText.length > 0 ||
    (phoneInput !== undefined && phoneInput !== null && typeof phoneInput !== "string") ||
    (emailInput !== undefined && emailInput !== null && typeof emailInput !== "string");

  const phone = normalizePhone(phoneText);
  if (phone !== null) {
    normalizedRecord["phone"] = phone;
  } else if (phoneText.length > 0) {
    delete normalizedRecord["phone"];
    errors.push({
      field: "phone",
      code: "invalid_phone",
      message: "Phone must contain 7 to 15 digits and may start with +.",
    });
  }

  const email = normalizeEmail(emailText);
  if (email !== null) {
    normalizedRecord["email"] = email;
  } else if (emailText.length > 0) {
    delete normalizedRecord["email"];
    errors.push({
      field: "email",
      code: "invalid_email",
      message: "Email must be a valid address.",
    });
  }

  let contactStatus: LeadContactStatus;
  if (phone !== null || email !== null) {
    contactStatus = "present";
  } else if (hasContactInput) {
    contactStatus = "invalid";
  } else {
    contactStatus = "missing";
    warnings.push({
      field: "contactDetails",
      code: "no_contact_details",
      message: "Lead has no phone or email yet; contact details are still missing.",
    });
  }

  return {
    ok: errors.length === 0,
    contactStatus,
    errors,
    warnings,
    normalized: normalizedRecord as PartialLead,
    duplicateKey: computeDuplicateKey({ phone, email }),
  };
}
