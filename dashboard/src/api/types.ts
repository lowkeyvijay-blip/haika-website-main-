import type {
  DashboardSummary,
  LeadDetail,
  LeadFilters,
} from "../../../src/actions/leadActions";
import type { OverdueResult } from "../../../src/automation/rules";
import type { SubmitLeadResult } from "../../../src/intake/leadIntake";
import type {
  ActivityLogEntry,
  EnquiryType,
  Lead,
  LeadSource,
  LeadStatus,
  OutboxMessage,
  Task,
} from "../../../src/types/lead";

export type {
  ActivityLogEntry,
  DashboardSummary,
  EnquiryType,
  Lead,
  LeadDetail,
  LeadFilters,
  LeadSource,
  LeadStatus,
  OutboxMessage,
  OverdueResult,
  SubmitLeadResult,
  Task,
};

export interface EnquiryPayload {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  size?: string;
  budgetRange?: string;
  notes?: string;
  enquiryType?: EnquiryType;
}

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ClockState {
  now: string;
  initialNow: string;
}

export interface DemoState {
  leads: number;
  tasks: number;
  outboxMessages: number;
  activityEntries: number;
  now: string;
}
