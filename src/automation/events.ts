import type { LeadStatus, PartialLead, Task } from "../types/lead";

interface AutomationEventBase {
  tasks?: readonly Task[];
}

export interface LeadCreatedEvent extends AutomationEventBase {
  type: "lead_created";
  roundRobinIndex?: number;
}

export interface DuplicateSubmissionEvent extends AutomationEventBase {
  type: "duplicate_submission";
  submission?: PartialLead;
}

export interface StatusChangedEvent extends AutomationEventBase {
  type: "status_changed";
  status: LeadStatus;
  allowReopen?: boolean;
}

export interface ReassignedEvent extends AutomationEventBase {
  type: "reassigned";
  owner: string;
  previousOwner?: string;
}

export type LeadAutomationEvent =
  | LeadCreatedEvent
  | DuplicateSubmissionEvent
  | StatusChangedEvent
  | ReassignedEvent;
