import { describe, expect, it } from "vitest";

import {
  hasContactDetails,
  meetsQualificationCriteria,
  shouldAutoQualify,
} from "./qualification";
import type { PartialLead } from "../types/lead";

function qualifiedLead(overrides: PartialLead = {}): PartialLead {
  return {
    status: "new",
    projectType: "kitchen",
    budgetRange: "25-40 lakh",
    timeline: "within 1 month",
    phone: "+91 98765 43210",
    ...overrides,
  };
}

describe("auto qualification rule", () => {
  it("qualifies a new lead with project, budget, timeline, and contact details", () => {
    expect(meetsQualificationCriteria(qualifiedLead())).toBe(true);
    expect(shouldAutoQualify(qualifiedLead())).toBe(true);
    expect(hasContactDetails(qualifiedLead({ phone: undefined, email: "ada@example.com" }))).toBe(
      true,
    );
  });

  it("does not qualify when any required qualification field is missing", () => {
    expect(shouldAutoQualify(qualifiedLead({ projectType: undefined }))).toBe(false);
    expect(shouldAutoQualify(qualifiedLead({ budgetRange: "   " }))).toBe(false);
    expect(shouldAutoQualify(qualifiedLead({ timeline: undefined }))).toBe(false);
  });

  it("does not qualify without usable contact details", () => {
    expect(hasContactDetails(qualifiedLead({ phone: undefined, email: undefined }))).toBe(false);
    expect(hasContactDetails(qualifiedLead({ phone: "nope", email: "nope" }))).toBe(false);
    expect(shouldAutoQualify(qualifiedLead({ phone: undefined }))).toBe(false);
  });

  it("only auto-qualifies leads that are still new", () => {
    expect(shouldAutoQualify(qualifiedLead({ status: "qualified" }))).toBe(false);
    expect(shouldAutoQualify(qualifiedLead({ status: "contacted" }))).toBe(false);
    expect(shouldAutoQualify(qualifiedLead({ status: "won" }))).toBe(false);
  });
});
