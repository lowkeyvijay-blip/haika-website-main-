import { DEFAULT_AUTOMATION_CONFIG } from "../../../src/automation/config";
import {
  ENQUIRY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUS_TRANSITIONS,
  LEAD_STATUSES,
  type EnquiryType,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type PreferredContactMethod,
  type Task,
} from "../../../src/types/lead";

export const TEAM = DEFAULT_AUTOMATION_CONFIG.team;

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  contacted: "Contacted",
  "consultation booked": "Consultation booked",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  "website form": "Website form",
  chatbot: "Chatbot",
  campaign: "Campaign",
  referral: "Referral",
  instagram: "Instagram",
};

export const ENQUIRY_TYPE_LABELS: Record<EnquiryType, string> = {
  "meet a designer": "Meet a Designer",
  "book free design session": "Book Free Design Session",
  "get free estimate": "Get Free Estimate",
};

export const PREFERRED_CONTACT_LABELS: Record<PreferredContactMethod, string> = {
  phone: "Phone",
  email: "Email",
  whatsapp: "WhatsApp",
};

export const ENQUIRY_TYPE_OPTIONS = ENQUIRY_TYPES.map((value) => ({
  value,
  label: ENQUIRY_TYPE_LABELS[value],
}));

const PROJECT_TYPE_CATEGORIES: Record<string, string> = {
  apartment: "Residential",
  villa: "Residential",
  home: "Residential",
  residential: "Residential",
  kitchen: "Modular kitchen",
  "modular kitchen": "Modular kitchen",
  office: "Commercial",
  commercial: "Commercial",
  healthcare: "Healthcare",
  hospital: "Healthcare",
  clinic: "Healthcare",
  architecture: "Architecture",
  landscaping: "Landscaping",
  "fit-out": "Fit-out",
  fitout: "Fit-out",
};

export function projectTypeCategory(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return (
    PROJECT_TYPE_CATEGORIES[trimmed.toLowerCase()] ??
    `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
  );
}

export const TASK_TYPE_LABELS: Record<Task["type"], string> = {
  acknowledgement: "Acknowledgement",
  follow_up: "Follow-up",
  collect_contact_details: "Collect contact details",
  consultation: "Consultation",
  proposal: "Proposal",
  other: "Other",
};

export const LEAD_STATUS_OPTIONS = LEAD_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

export const LEAD_SOURCE_OPTIONS = LEAD_SOURCES.map((value) => ({
  value,
  label: SOURCE_LABELS[value],
}));

export function statusOptionsFor(status: LeadStatus): LeadStatus[] {
  return [...LEAD_STATUS_TRANSITIONS[status]];
}

export function displayName(lead: Lead): string {
  const name = lead.name?.trim();

  if (name !== undefined && name.length > 0) {
    return name;
  }

  return lead.email ?? lead.phone ?? "Unnamed enquiry";
}

export function initials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}
