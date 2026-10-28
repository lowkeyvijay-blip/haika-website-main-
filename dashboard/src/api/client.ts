import type {
  ApiResult,
  ClockState,
  DashboardSummary,
  DemoState,
  EnquiryPayload,
  Lead,
  LeadDetail,
  LeadFilters,
  OverdueResult,
  SubmitLeadResult,
  Task,
  ActivityLogEntry,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(
  /\/$/,
  "",
) ?? "/api";

function isApiResult(value: unknown): value is ApiResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const text = await response.text();
    let payload: unknown;

    try {
      payload = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "The local API returned an unreadable response.",
        },
      };
    }

    if (!isApiResult(payload)) {
      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "The local API returned an unexpected response.",
        },
      };
    }

    return payload as ApiResult<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Could not reach the local API. Check that npm run dev is running.",
      },
    };
  }
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(value),
  };
}

function leadQuery(filters: LeadFilters): string {
  const params = new URLSearchParams();

  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }

  if (filters.source !== undefined) {
    params.set("source", filters.source);
  }

  if (filters.owner !== undefined) {
    params.set("owner", filters.owner);
  }

  if (filters.overdue !== undefined) {
    params.set("overdue", String(filters.overdue));
  }

  if (filters.search !== undefined && filters.search.trim().length > 0) {
    params.set("search", filters.search.trim());
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export const api = {
  getSummary(): Promise<ApiResult<DashboardSummary>> {
    return request<DashboardSummary>("/summary");
  },

  listLeads(filters: LeadFilters = {}): Promise<ApiResult<Lead[]>> {
    return request<Lead[]>(`/leads${leadQuery(filters)}`);
  },

  getLead(id: string): Promise<ApiResult<LeadDetail>> {
    return request<LeadDetail>(`/leads/${encodeURIComponent(id)}`);
  },

  updateStatus(
    id: string,
    status: string,
    note?: string,
  ): Promise<ApiResult<LeadDetail>> {
    return request<LeadDetail>(`/leads/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    });
  },

  reassign(id: string, owner: string): Promise<ApiResult<LeadDetail>> {
    return request<LeadDetail>(
      `/leads/${encodeURIComponent(id)}/reassign`,
      jsonBody({ owner }),
    );
  },

  addNote(id: string, text: string): Promise<ApiResult<ActivityLogEntry>> {
    return request<ActivityLogEntry>(
      `/leads/${encodeURIComponent(id)}/notes`,
      jsonBody({ text }),
    );
  },

  completeTask(taskId: string): Promise<ApiResult<Task>> {
    return request<Task>(
      `/tasks/${encodeURIComponent(taskId)}/complete`,
      jsonBody({}),
    );
  },

  submitEnquiry(payload: EnquiryPayload): Promise<ApiResult<SubmitLeadResult>> {
    return request<SubmitLeadResult>("/enquiries", jsonBody(payload));
  },

  runOverdueCheck(): Promise<ApiResult<OverdueResult>> {
    return request<OverdueResult>("/overdue-check", jsonBody({}));
  },

  getClock(): Promise<ApiResult<ClockState>> {
    return request<ClockState>("/clock");
  },

  setClock(now: string): Promise<ApiResult<ClockState>> {
    return request<ClockState>("/clock", jsonBody({ now }));
  },

  advanceClock(advanceByMs: number): Promise<ApiResult<ClockState>> {
    return request<ClockState>("/clock", jsonBody({ advanceByMs }));
  },

  seedDemo(): Promise<ApiResult<DemoState>> {
    return request<DemoState>("/seed", jsonBody({}));
  },

  resetDemo(): Promise<ApiResult<DemoState>> {
    return request<DemoState>("/reset", jsonBody({}));
  },
};
