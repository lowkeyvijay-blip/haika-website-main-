import type { LeadStatus } from "../types/lead";

export interface OwnerRoutingRule {
  owner: string;
  projectTypes?: readonly string[];
  locations?: readonly string[];
}

export interface FollowUpHours {
  hot: number;
  standard: number;
  cold: number;
}

export interface AutomationConfig {
  team: readonly string[];
  routingRules: readonly OwnerRoutingRule[];
  followUpHours: FollowUpHours;
  hotProjectTypes: readonly string[];
  hotTimelines: readonly string[];
  coldTimelines: readonly string[];
  collectContactDetailsHours: number;
  collectContactDetailsAction: string;
  defaultNextActions: Readonly<Record<LeadStatus, string>>;
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  team: ["Aarav Mehta", "Priya Nair", "Rohan Kapoor"],
  routingRules: [
    { owner: "Priya Nair", projectTypes: ["kitchen", "bathroom"] },
    { owner: "Rohan Kapoor", locations: ["pune", "mumbai"] },
  ],
  followUpHours: {
    hot: 2,
    standard: 24,
    cold: 48,
  },
  hotProjectTypes: ["full home", "kitchen"],
  hotTimelines: ["asap", "immediately", "within 1 month", "0-3 months"],
  coldTimelines: ["exploring", "no rush", "6+ months", "12+ months"],
  collectContactDetailsHours: 4,
  collectContactDetailsAction: "Collect contact details.",
  defaultNextActions: {
    new: "Review the enquiry and make first contact.",
    qualified: "Book a consultation with the lead.",
    contacted: "Confirm requirements and agree the next step.",
    "consultation booked": "Prepare for the consultation.",
    proposal: "Follow up on the proposal.",
    won: "Send the welcome pack and hand off to delivery.",
    lost: "Record the reason and close out the enquiry.",
  },
};
