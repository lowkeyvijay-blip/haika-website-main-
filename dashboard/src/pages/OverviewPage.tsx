import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type { ClockState, DashboardSummary, Lead } from "../api/types";
import { Button, LeadAvatar, LoadingPanel, Notice } from "../components/ui";
import { formatTime, formatWeekday, pluralize } from "../lib/format";
import { displayName, LEAD_STATUS_OPTIONS } from "../lib/lookups";

interface Feedback {
  tone: "success" | "error";
  message: string;
}

interface AttentionItem {
  lead: Lead;
  reason: "Overdue follow-up" | "Missing contact" | "Unassigned";
  priority: number;
}

type BusyAction = "overdue" | "";

function activityValue(lead: Lead): string {
  return lead.lastActivity ?? lead.updatedAt ?? lead.createdAt;
}

export function OverviewPage(): React.JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [overdueLeads, setOverdueLeads] = useState<Lead[]>([]);
  const [clock, setClock] = useState<ClockState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState<BusyAction>("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }

    const [summaryResult, leadsResult, overdueResult, clockResult] =
      await Promise.all([
        api.getSummary(),
        api.listLeads(),
        api.listLeads({ overdue: true }),
        api.getClock(),
      ]);

    if (!summaryResult.ok) {
      setError(summaryResult.error.message);
      setLoading(false);
      return;
    }

    if (!leadsResult.ok) {
      setError(leadsResult.error.message);
      setLoading(false);
      return;
    }

    if (!overdueResult.ok) {
      setError(overdueResult.error.message);
      setLoading(false);
      return;
    }

    if (!clockResult.ok) {
      setError(clockResult.error.message);
      setLoading(false);
      return;
    }

    setError("");
    setSummary(summaryResult.data);
    setLeads(leadsResult.data);
    setOverdueLeads(overdueResult.data);
    setClock(clockResult.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runOverdueCheck(): Promise<void> {
    setBusy("overdue");
    setFeedback(undefined);
    const result = await api.runOverdueCheck();

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
    } else {
      const count = result.data.tasks.length;
      setFeedback({
        tone: "success",
        message:
          count === 0
            ? "No follow-ups were due."
            : `${pluralize(count, "follow-up")} escalated to overdue.`,
      });
      await load(true);
    }

    setBusy("");
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingPanel label="Opening the lead desk" />
      </div>
    );
  }

  if (summary === undefined || clock === undefined) {
    return (
      <div className="page">
        <Notice tone="error">{error || "The dashboard could not be loaded."}</Notice>
      </div>
    );
  }

  const overdueIds = new Set(overdueLeads.map((lead) => lead.id));
  const attention: AttentionItem[] = [];

  for (const lead of leads) {
    const noContact =
      (lead.phone?.trim().length ?? 0) === 0 &&
      (lead.email?.trim().length ?? 0) === 0;

    if (overdueIds.has(lead.id)) {
      attention.push({ lead, reason: "Overdue follow-up", priority: 0 });
    } else if (noContact) {
      attention.push({ lead, reason: "Missing contact", priority: 1 });
    } else if ((lead.owner?.trim().length ?? 0) === 0) {
      attention.push({ lead, reason: "Unassigned", priority: 2 });
    }
  }

  attention.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return activityValue(left.lead).localeCompare(activityValue(right.lead));
  });

  const busiest = busy !== "";

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Today at Haika</h1>
          <p className="page-lede">
            A clear view of enquiries, follow-ups and the work that needs a designer&apos;s
            attention.
          </p>
        </div>
        <div className="heading-actions">
          <span className="date-stamp">
            <span>{formatWeekday(clock.now)}</span>
            <strong>{formatTime(clock.now)} IST</strong>
          </span>
          <Button
            variant="primary"
            onClick={() => void runOverdueCheck()}
            disabled={busiest}
          >
            {busy === "overdue" ? "Checking..." : "Run overdue check"}
          </Button>
        </div>
      </header>

      {error.length > 0 ? <Notice tone="error">{error}</Notice> : null}
      {feedback !== undefined ? (
        <Notice tone={feedback.tone}>{feedback.message}</Notice>
      ) : null}

      <section className="kpi-grid kpi-grid-3" aria-label="Operational summary">
        <article className="kpi-card kpi-card-accent">
          <span className="kpi-label">Overdue follow-ups</span>
          <strong className="kpi-value">{summary.overdue}</strong>
          <span className="kpi-hint">
            {summary.overdue === 0
              ? "Nothing past due"
              : "Leads with a task past its due time"}
          </span>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Without contact details</span>
          <strong className="kpi-value">{summary.withoutContactDetails}</strong>
          <span className="kpi-hint">No phone or email on record</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Unassigned</span>
          <strong className="kpi-value">{summary.unassigned}</strong>
          <span className="kpi-hint">
            {summary.unassigned === 0
              ? "Every lead has an owner"
              : "Waiting for a designer"}
          </span>
        </article>
      </section>

      <section className="status-summary" aria-label="Leads by status">
        {LEAD_STATUS_OPTIONS.map((option) => (
          <Link
            className={`status-summary-card ${
              option.value === "won" || option.value === "lost"
                ? "status-summary-card-closed"
                : ""
            }`}
            key={option.value}
            to={`/leads?status=${encodeURIComponent(option.value)}`}
          >
            <span className={`status-dot status-${option.value.replaceAll(" ", "-")}`} />
            <span className="status-summary-label">{option.label}</span>
            <strong>{summary.byStatus[option.value]}</strong>
          </Link>
        ))}
      </section>

      <div className="overview-grid">
        <section className="panel pipeline-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Live pipeline</p>
              <h2>Lead flow</h2>
            </div>
            <span className="panel-total">{summary.totalLeads} total</span>
          </div>

          <div className="pipeline-list">
            {LEAD_STATUS_OPTIONS.map((option) => {
              const count = summary.byStatus[option.value];
              const percentage =
                summary.totalLeads === 0 ? 0 : (count / summary.totalLeads) * 100;

              return (
                <div className="pipeline-row" key={option.value}>
                  <span className="pipeline-label">{option.label}</span>
                  <span className="pipeline-track">
                    <span
                      className={`pipeline-fill pipeline-${option.value.replaceAll(" ", "-")}`}
                      style={{
                        width: `${percentage}%`,
                        minWidth: count > 0 ? "6px" : "0",
                      }}
                    />
                  </span>
                  <span className="pipeline-count">{count}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="overview-side">
          <section className="panel attention-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Priority</p>
                <h2>Needs attention</h2>
              </div>
              <Link className="text-link" to="/leads">
                All leads
              </Link>
            </div>

            {attention.length === 0 ? (
              <p className="panel-empty">No leads need attention. The desk is clear.</p>
            ) : (
              <ul className="attention-list">
                {attention.slice(0, 6).map((item) => (
                  <li key={item.lead.id}>
                    <Link className="attention-item" to={`/leads/${item.lead.id}`}>
                      <LeadAvatar
                        name={displayName(item.lead)}
                        owner={item.lead.owner}
                        size="small"
                      />
                      <span className="attention-copy">
                        <strong>{displayName(item.lead)}</strong>
                        <span
                          className={
                            item.priority === 0
                              ? "attention-reason attention-reason-overdue"
                              : "attention-reason"
                          }
                        >
                          {item.reason}
                        </span>
                      </span>
                      <span className="attention-owner">
                        {item.lead.owner ?? "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel demo-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Demo controls</p>
                <h2>Studio clock</h2>
              </div>
            </div>

            <div className="clock-card">
              <span className="clock-label">Pinned clock</span>
              <strong>{formatWeekday(clock.now)}</strong>
              <span className="clock-time">{formatTime(clock.now)} IST</span>
            </div>

            <Link className="button button-secondary button-block" to="/demo">
              Open demo controls
            </Link>

            <p className="demo-note">
              Advance or reset the clock, run overdue checks, restore sample data, and
              simulate website enquiries.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
