import type { ActivityLogEntry, Lead, OutboxMessage, Task } from "../types/lead";

export interface LeadStoreState {
  leads: Lead[];
  tasks: Task[];
  outboxMessages: OutboxMessage[];
  activityLog: ActivityLogEntry[];
}

export interface LeadRepository {
  getLead(id: string): Promise<Lead | undefined>;
  listLeads(): Promise<Lead[]>;
  saveLead(lead: Lead): Promise<Lead>;

  getTask(id: string): Promise<Task | undefined>;
  listTasks(leadId?: string): Promise<Task[]>;
  saveTask(task: Task): Promise<Task>;

  getOutboxMessage(id: string): Promise<OutboxMessage | undefined>;
  listOutboxMessages(leadId?: string): Promise<OutboxMessage[]>;
  saveOutboxMessage(message: OutboxMessage): Promise<OutboxMessage>;

  getActivityLogEntry(id: string): Promise<ActivityLogEntry | undefined>;
  listActivityLog(leadId?: string): Promise<ActivityLogEntry[]>;
  saveActivityLogEntry(entry: ActivityLogEntry): Promise<ActivityLogEntry>;

  replaceAll(state: LeadStoreState): Promise<void>;
}

export function emptyLeadStoreState(): LeadStoreState {
  return {
    leads: [],
    tasks: [],
    outboxMessages: [],
    activityLog: [],
  };
}
