import { normalizeEmail, normalizePhone, type PartialLead } from "../types/lead";

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasContactDetails(lead: PartialLead): boolean {
  return normalizePhone(lead.phone) !== null || normalizeEmail(lead.email) !== null;
}

export function meetsQualificationCriteria(lead: PartialLead): boolean {
  return (
    hasText(lead.projectType) &&
    hasText(lead.budgetRange) &&
    hasText(lead.timeline) &&
    hasContactDetails(lead)
  );
}

export function shouldAutoQualify(lead: PartialLead): boolean {
  return lead.status === "new" && meetsQualificationCriteria(lead);
}
