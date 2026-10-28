import { describe, expect, it } from "vitest";

import {
  ENQUIRY_TYPES,
  LEAD_STATUS_TRANSITIONS,
  canTransitionLeadStatus,
  computeDuplicateKey,
  isEnquiryType,
  isLeadStatus,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  validateLead,
} from "./lead";

describe("normalization", () => {
  it("trims names and treats blank names as absent", () => {
    expect(normalizeName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeName("   ")).toBeUndefined();
    expect(normalizeName(null)).toBeUndefined();
  });

  it("normalizes valid phone numbers", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("(555) 123.4567")).toBe("5551234567");
    expect(normalizePhone(" 9876543210 ")).toBe("9876543210");
  });

  it("rejects malformed phone numbers", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("++919876543210")).toBeNull();
    expect(normalizePhone("9198765432101234567")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("rejects malformed email addresses", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("jane@example")).toBeNull();
    expect(normalizeEmail("jane @example.com")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("computes a duplicate key from normalized phone or email", () => {
    expect(computeDuplicateKey({ phone: "+91 98765-43210" })).toBe("phone:+919876543210");
    expect(computeDuplicateKey({ email: " Jane@Example.COM " })).toBe("email:jane@example.com");
    expect(
      computeDuplicateKey({ phone: "+91 98765-43210", email: "jane@example.com" }),
    ).toBe("phone:+919876543210");
    expect(computeDuplicateKey({ phone: "invalid", email: "jane@example.com" })).toBe(
      "email:jane@example.com",
    );
    expect(computeDuplicateKey({})).toBeNull();
    expect(computeDuplicateKey({ phone: "invalid", email: "invalid" })).toBeNull();
  });
});

describe("validateLead", () => {
  it("accepts a partial lead with only a name and warns about missing contact details", () => {
    const result = validateLead({ name: "  Ada Lovelace  " });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ field: "contactDetails", code: "no_contact_details" }),
    ]);
    expect(result.contactStatus).toBe("missing");
    expect(result.normalized.name).toBe("Ada Lovelace");
    expect(result.duplicateKey).toBeNull();
  });

  it("accepts an empty lead without crashing and flags only a warning", () => {
    const result = validateLead({});

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.contactStatus).toBe("missing");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["no_contact_details"]);
  });

  it("treats blank contact fields as missing rather than malformed", () => {
    const result = validateLead({ phone: "   ", email: "" });

    expect(result.ok).toBe(true);
    expect(result.contactStatus).toBe("missing");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["no_contact_details"]);
  });

  it("accepts email-only contact details", () => {
    const result = validateLead({ email: " Jane@Example.COM " });

    expect(result.ok).toBe(true);
    expect(result.contactStatus).toBe("present");
    expect(result.normalized.email).toBe("jane@example.com");
    expect(result.duplicateKey).toBe("email:jane@example.com");
    expect(result.warnings).toEqual([]);
  });

  it("normalizes phone and email when both are valid", () => {
    const result = validateLead({
      name: "Ada",
      phone: "+91 98765-43210",
      email: " ADA@Example.COM ",
      preferredContactMethod: "email",
    });

    expect(result.ok).toBe(true);
    expect(result.contactStatus).toBe("present");
    expect(result.normalized.phone).toBe("+919876543210");
    expect(result.normalized.email).toBe("ada@example.com");
    expect(result.duplicateKey).toBe("phone:+919876543210");
  });

  it("reports a malformed phone as an error, not a missing-contact warning", () => {
    const result = validateLead({ phone: "not-a-phone" });

    expect(result.ok).toBe(false);
    expect(result.contactStatus).toBe("invalid");
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "phone", code: "invalid_phone" }),
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.normalized.phone).toBeUndefined();
  });

  it("reports a malformed email as an error, not a missing-contact warning", () => {
    const result = validateLead({ email: "jane@example" });

    expect(result.ok).toBe(false);
    expect(result.contactStatus).toBe("invalid");
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "email", code: "invalid_email" }),
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.normalized.email).toBeUndefined();
  });

  it("reports an invalid status without crashing", () => {
    const result = validateLead({ status: "pending" });

    expect(result.ok).toBe(false);
    expect(result.normalized.status).toBeUndefined();
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "status", code: "invalid_status" }),
    ]);
  });

  it("reports invalid source and preferred contact method values", () => {
    const result = validateLead({
      source: "billboard",
      preferredContactMethod: "carrier pigeon",
    });

    expect(result.ok).toBe(false);
    expect(result.normalized.source).toBeUndefined();
    expect(result.normalized.preferredContactMethod).toBeUndefined();
    expect(result.errors.map((error) => error.code)).toEqual([
      "invalid_source",
      "invalid_preferred_contact_method",
    ]);
  });

  it("accepts all OSM enquiry types and rejects unknown values", () => {
    for (const enquiryType of ENQUIRY_TYPES) {
      expect(isEnquiryType(enquiryType)).toBe(true);
      expect(validateLead({ enquiryType }).normalized.enquiryType).toBe(enquiryType);
    }

    const result = validateLead({ enquiryType: "phone call" });
    expect(result.ok).toBe(false);
    expect(result.normalized.enquiryType).toBeUndefined();
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "enquiryType", code: "invalid_enquiry_type" }),
    ]);
  });

  it("rejects non-object input without throwing", () => {
    expect(validateLead(null).ok).toBe(false);
    expect(validateLead("lead").errors).toEqual([
      expect.objectContaining({ code: "invalid_lead" }),
    ]);
    expect(() => validateLead(undefined)).not.toThrow();
  });
});

describe("status transitions", () => {
  it("identifies valid statuses", () => {
    expect(isLeadStatus("consultation booked")).toBe(true);
    expect(isLeadStatus("new")).toBe(true);
    expect(isLeadStatus("pending")).toBe(false);
    expect(isLeadStatus(null)).toBe(false);
  });

  it("allows forward transitions defined in the map", () => {
    expect(canTransitionLeadStatus("new", "qualified")).toBe(true);
    expect(canTransitionLeadStatus("qualified", "consultation booked")).toBe(true);
    expect(canTransitionLeadStatus("contacted", "proposal")).toBe(true);
    expect(canTransitionLeadStatus("proposal", "won")).toBe(true);
    expect(canTransitionLeadStatus("contacted", "lost")).toBe(true);
  });

  it("rejects skipped, backward, duplicate, and unknown transitions", () => {
    expect(canTransitionLeadStatus("new", "won")).toBe(false);
    expect(canTransitionLeadStatus("new", "proposal")).toBe(false);
    expect(canTransitionLeadStatus("contacted", "new")).toBe(false);
    expect(canTransitionLeadStatus("won", "won")).toBe(false);
    expect(canTransitionLeadStatus("bogus", "contacted")).toBe(false);
    expect(canTransitionLeadStatus("new", "bogus")).toBe(false);
  });

  it("keeps won and lost terminal unless explicitly reopened", () => {
    expect(LEAD_STATUS_TRANSITIONS.won).toEqual([]);
    expect(LEAD_STATUS_TRANSITIONS.lost).toEqual([]);
    expect(canTransitionLeadStatus("won", "contacted")).toBe(false);
    expect(canTransitionLeadStatus("lost", "qualified")).toBe(false);
    expect(canTransitionLeadStatus("won", "contacted", { allowReopen: true })).toBe(true);
    expect(canTransitionLeadStatus("lost", "qualified", { allowReopen: true })).toBe(true);
    expect(canTransitionLeadStatus("won", "proposal", { allowReopen: true })).toBe(false);
  });
});
