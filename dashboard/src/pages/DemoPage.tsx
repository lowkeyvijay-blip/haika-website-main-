import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type {
  ClockState,
  DashboardSummary,
  EnquiryPayload,
  EnquiryType,
  LeadDetail,
  SubmitLeadResult,
} from "../api/types";
import {
  Badge,
  Button,
  Card,
  Input,
  LoadingPanel,
  Modal,
  Notice,
  Select,
  StatusBadge,
  Textarea,
} from "../components/ui";
import { formatDateTime, formatWeekday, pluralize } from "../lib/format";
import {
  ENQUIRY_TYPE_OPTIONS,
  TASK_TYPE_LABELS,
} from "../lib/lookups";

interface EnquiryForm {
  name: string;
  email: string;
  mobile: string;
  location: string;
  size: string;
  budgetRange: string;
  notes: string;
  enquiryType: EnquiryType;
}

interface EnquiryReport {
  result: SubmitLeadResult;
  detail?: LeadDetail;
  detailError?: string;
}

interface CheckSummary {
  escalated: number;
  affectedLeads: number;
  overdueLeads: number;
}

interface Feedback {
  tone: "success" | "error" | "info";
  message: string;
}

type BusyAction =
  | "hour"
  | "day"
  | "three-days"
  | "pinned"
  | "overdue"
  | "reset"
  | "submit"
  | "";

const EMPTY_FORM: EnquiryForm = {
  name: "",
  email: "",
  mobile: "",
  location: "",
  size: "",
  budgetRange: "",
  notes: "",
  enquiryType: "meet a designer",
};

const PRESETS: Record<string, EnquiryForm> = {
  full: {
    name: "Aisha Menon",
    email: "aisha.menon@example.com",
    mobile: "+91 90000 00001",
    location: "Hyderabad",
    size: "1,650 sq ft",
    budgetRange: "25-40 lakh",
    notes:
      "3BHK apartment; warm minimal interiors and a modular kitchen. Wants a full-home design session.",
    enquiryType: "meet a designer",
  },
  partial: {
    name: "Ritika Sen",
    email: "ritika.sen@example.com",
    mobile: "",
    location: "Hyderabad",
    size: "",
    budgetRange: "",
    notes: "Looking for a two-bedroom refresh and wants to discuss timelines first.",
    enquiryType: "book free design session",
  },
  "no-contact": {
    name: "Walk-in Enquiry",
    email: "",
    mobile: "",
    location: "Hyderabad",
    size: "",
    budgetRange: "",
    notes:
      "Studio walk-in interested in a full-home project. Contact details were not collected.",
    enquiryType: "meet a designer",
  },
  duplicate: {
    name: "Meera Iyer",
    email: "meera.iyer@example.com",
    mobile: "+91 98111 20304",
    location: "Pune",
    size: "3,200 sq ft",
    budgetRange: "1-1.5 crore",
    notes: "Following up on the villa consultation; adding a home office to the brief.",
    enquiryType: "book free design session",
  },
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function hasContact(form: EnquiryForm): boolean {
  return form.mobile.trim().length > 0 || form.email.trim().length > 0;
}

export function DemoPage(): React.JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [clock, setClock] = useState<ClockState>();
  const [baselineOverdue, setBaselineOverdue] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState<BusyAction>("");
  const [form, setForm] = useState<EnquiryForm>(EMPTY_FORM);
  const [report, setReport] = useState<EnquiryReport>();
  const [checkResult, setCheckResult] = useState<CheckSummary>();
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(
    async (options: { resetBaseline?: boolean } = {}): Promise<void> => {
      const [summaryResult, clockResult] = await Promise.all([
        api.getSummary(),
        api.getClock(),
      ]);

      if (!summaryResult.ok) {
        setLoadError(summaryResult.error.message);
        setLoading(false);
        return;
      }

      if (!clockResult.ok) {
        setLoadError(clockResult.error.message);
        setLoading(false);
        return;
      }

      setLoadError("");
      setSummary(summaryResult.data);
      setClock(clockResult.data);
      setBaselineOverdue((current) =>
        options.resetBaseline === true || current === undefined
          ? summaryResult.data.overdue
          : current,
      );
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    void load({ resetBaseline: true });
  }, [load]);

  function updateForm(patch: Partial<EnquiryForm>): void {
    setForm((current) => ({ ...current, ...patch }));
    setReport(undefined);
  }

  function applyPreset(preset: EnquiryForm): void {
    setForm(preset);
    setReport(undefined);
    setFeedback(undefined);
  }

  async function shiftClock(amountMs: number, label: string, action: BusyAction): Promise<void> {
    setBusy(action);
    setFeedback(undefined);
    setCheckResult(undefined);
    const result = await api.advanceClock(amountMs);

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
    } else {
      setClock(result.data);
      await load();
      setFeedback({
        tone: "success",
        message: `Demo clock advanced ${label}. Overdue checks now use the new time.`,
      });
    }

    setBusy("");
  }

  async function resetClock(): Promise<void> {
    if (clock === undefined) {
      return;
    }

    setBusy("pinned");
    setFeedback(undefined);
    setCheckResult(undefined);
    const result = await api.setClock(clock.initialNow);

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
    } else {
      setClock(result.data);
      await load();
      setFeedback({
        tone: "success",
        message:
          "Clock reset to the pinned demo time. Task status changes already made by automation remain until the data is reset.",
      });
    }

    setBusy("");
  }

  async function runOverdueCheck(): Promise<void> {
    setBusy("overdue");
    setFeedback(undefined);
    const result = await api.runOverdueCheck();

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
      setBusy("");
      return;
    }

    const summaryResult = await api.getSummary();
    const overdueLeads = summaryResult.ok
      ? summaryResult.data.overdue
      : (summary?.overdue ?? 0);
    const affectedLeads = new Set(result.data.tasks.map((task) => task.leadId)).size;

    if (summaryResult.ok) {
      setSummary(summaryResult.data);
    }

    setCheckResult({
      escalated: result.data.tasks.length,
      affectedLeads,
      overdueLeads,
    });
    setFeedback({
      tone: result.data.tasks.length === 0 ? "info" : "success",
      message:
        result.data.tasks.length === 0
          ? "No new follow-ups needed escalation at the current demo time."
          : `${pluralize(result.data.tasks.length, "follow-up")} escalated across ${pluralize(affectedLeads, "lead")}.`,
    });
    setBusy("");
  }

  async function confirmResetDemo(): Promise<void> {
    setBusy("reset");
    setFeedback(undefined);
    const result = await api.resetDemo();

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
      setBusy("");
      return;
    }

    setConfirmReset(false);
    setCheckResult(undefined);
    setReport(undefined);
    await load({ resetBaseline: true });
    setFeedback({
      tone: "success",
      message: `Demo data restored: ${pluralize(result.data.leads, "lead")}, ${pluralize(result.data.tasks, "task")}, ${pluralize(result.data.outboxMessages, "outbox message")}, and ${pluralize(result.data.activityEntries, "activity entry")}. The pinned clock is back in place.`,
    });
    setBusy("");
  }

  async function submitEnquiry(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("submit");
    setFeedback(undefined);

    const payload: EnquiryPayload = {
      name: form.name,
      email: form.email,
      phone: form.mobile,
      location: form.location,
      size: form.size,
      budgetRange: form.budgetRange,
      notes: form.notes,
      enquiryType: form.enquiryType,
    };
    const result = await api.submitEnquiry(payload);

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.error.message });
      setBusy("");
      return;
    }

    const detailResult = await api.getLead(result.data.leadId);
    const nextReport: EnquiryReport = {
      result: result.data,
      detail: detailResult.ok ? detailResult.data : undefined,
      detailError: detailResult.ok ? undefined : detailResult.error.message,
    };

    setReport(nextReport);
    setFeedback({
      tone: "success",
      message:
        result.data.outcome === "created"
          ? "Website enquiry created a new lead."
          : "Duplicate detected; the enquiry was merged into the existing lead.",
    });
    await load();
    setBusy("");
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingPanel label="Preparing demo controls" />
      </div>
    );
  }

  if (summary === undefined || clock === undefined) {
    return (
      <div className="page">
        <Notice tone="error">{loadError || "Demo controls could not be loaded."}</Notice>
      </div>
    );
  }

  const currentOverdue = summary.overdue;
  const baseline = baselineOverdue ?? currentOverdue;
  const overdueDelta = currentOverdue - baseline;
  const noContact = !hasContact(form);
  const busiest = busy !== "";
  const collectTask = report?.detail?.tasks.find(
    (task) => task.type === "collect_contact_details" && task.status !== "cancelled",
  );
  const reportLead = report?.detail?.lead;
  const reportNoContact =
    reportLead !== undefined &&
    (reportLead.phone?.trim().length ?? 0) === 0 &&
    (reportLead.email?.trim().length ?? 0) === 0;
  const acknowledgementLabel =
    report === undefined
      ? ""
      : report.result.acknowledgementQueued
        ? "Queued"
        : report.result.outcome === "merged"
          ? "Not queued on merge"
          : reportNoContact
            ? "Skipped — no contact details"
            : "Not queued";

  return (
    <div className="page demo-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Demo controls</p>
          <h1>Show the automation live</h1>
          <p className="page-lede">
            Move the pinned studio clock, escalate overdue follow-ups, restore the
            sample workspace, and submit website enquiries through the same intake
            path the demo uses.
          </p>
        </div>
        <span className="demo-heading-badge">
          <span className="live-dot" aria-hidden="true" />
          Local demo workspace
        </span>
      </header>

      {loadError.length > 0 ? <Notice tone="error">{loadError}</Notice> : null}
      {feedback !== undefined ? (
        <Notice tone={feedback.tone}>{feedback.message}</Notice>
      ) : null}

      <div className="demo-grid">
        <div className="demo-main">
          <section className="panel" aria-labelledby="simulate-enquiry-title">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Website intake</p>
                <h2 id="simulate-enquiry-title">Simulate an enquiry</h2>
              </div>
              <span className="panel-total">Same intake function</span>
            </div>

            <div className="preset-block">
              <span className="preset-label">Start from a preset</span>
              <div className="preset-row">
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => applyPreset(PRESETS["full"] as EnquiryForm)}
                  disabled={busiest}
                >
                  Full lead
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => applyPreset(PRESETS["partial"] as EnquiryForm)}
                  disabled={busiest}
                >
                  Partial lead
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => applyPreset(PRESETS["no-contact"] as EnquiryForm)}
                  disabled={busiest}
                >
                  No contact
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => applyPreset(PRESETS["duplicate"] as EnquiryForm)}
                  disabled={busiest}
                  title="Merges into the existing Meera Iyer lead by phone"
                >
                  Duplicate lead
                </button>
              </div>
              <p className="preset-copy">
                Presets only fill the form. Review the details, then submit to run
                routing, acknowledgement, merge, and task automation.
              </p>
            </div>

            <form className="enquiry-form" onSubmit={(event) => void submitEnquiry(event)}>
              <div className="enquiry-form-grid">
                <label className="field">
                  <span>Name</span>
                  <Input
                    value={form.name}
                    onChange={(event) => updateForm({ name: event.target.value })}
                    placeholder="Fictional visitor name"
                    disabled={busiest}
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) => updateForm({ email: event.target.value })}
                    placeholder="visitor@example.com"
                    disabled={busiest}
                  />
                </label>
                <label className="field">
                  <span>Mobile</span>
                  <Input
                    type="tel"
                    value={form.mobile}
                    onChange={(event) => updateForm({ mobile: event.target.value })}
                    placeholder="+91 90000 00001"
                    disabled={busiest}
                  />
                </label>
                <label className="field">
                  <span>Enquiry type</span>
                  <Select
                    value={form.enquiryType}
                    onChange={(event) =>
                      updateForm({ enquiryType: event.target.value as EnquiryType })
                    }
                    disabled={busiest}
                  >
                    {ENQUIRY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span>Where interiors are needed</span>
                  <Input
                    value={form.location}
                    onChange={(event) => updateForm({ location: event.target.value })}
                    placeholder="Locality or city"
                    disabled={busiest}
                  />
                </label>
                <label className="field">
                  <span>Home size</span>
                  <Input
                    value={form.size}
                    onChange={(event) => updateForm({ size: event.target.value })}
                    placeholder="e.g. 1,650 sq ft"
                    disabled={busiest}
                  />
                </label>
                <label className="field">
                  <span>Budget range</span>
                  <Input
                    value={form.budgetRange}
                    onChange={(event) => updateForm({ budgetRange: event.target.value })}
                    placeholder="e.g. 25-40 lakh"
                    disabled={busiest}
                  />
                </label>
                <label className="field field-wide">
                  <span>Project notes</span>
                  <Textarea
                    value={form.notes}
                    onChange={(event) => updateForm({ notes: event.target.value })}
                    placeholder="Scope, rooms, style, or timing"
                    disabled={busiest}
                  />
                </label>
              </div>

              {noContact ? (
                <div className="inline-warning" role="status">
                  <strong>No contact details.</strong> The acknowledgement will be
                  skipped and automation will create a &quot;Collect contact
                  details&quot; task.
                </div>
              ) : null}

              <div className="enquiry-form-actions">
                <p className="form-note">
                  Demo data only. Use fictional names and phone numbers.
                </p>
                <Button type="submit" disabled={busiest}>
                  {busy === "submit" ? "Submitting..." : "Simulate website enquiry"}
                </Button>
              </div>
            </form>
          </section>

          {report !== undefined ? (
            <Card
              as="section"
              className={`enquiry-result enquiry-result-${report.result.outcome}`}
              aria-live="polite"
            >
              <div className="enquiry-result-heading">
                <div>
                  <p className="panel-kicker">Intake result</p>
                  <h2>
                    {report.result.outcome === "created" ? "Lead created" : "Lead merged"}
                  </h2>
                </div>
                <Badge
                  tone={report.result.outcome === "created" ? "success" : "brass"}
                >
                  {report.result.outcome === "created" ? "Created" : "Merged"}
                </Badge>
              </div>

              <dl className="result-grid">
                <div>
                  <dt>Lead</dt>
                  <dd>
                    <Link className="result-lead-link" to={`/leads/${report.result.leadId}`}>
                      {reportLead?.name ?? report.result.leadId}
                    </Link>
                    <span>{report.result.leadId}</span>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={report.result.status} />
                  </dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>
                    <strong>{report.result.owner ?? "Unassigned"}</strong>
                    <span>
                      {report.result.outcome === "merged"
                        ? "Existing owner kept"
                        : "Assigned by automation"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Acknowledgement</dt>
                  <dd>
                    <strong>{acknowledgementLabel}</strong>
                    <span>Simulated outbox only</span>
                  </dd>
                </div>
                {report.result.matchedBy !== undefined ? (
                  <div>
                    <dt>Matched by</dt>
                    <dd>
                      <strong>{report.result.matchedBy}</strong>
                      <span>Duplicate submission</span>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {reportNoContact ? (
                <div className="inline-warning">
                  <strong>No phone or email on file.</strong> This lead will show a
                  contact warning until details are collected.
                </div>
              ) : null}

              {collectTask !== undefined ? (
                <div className="result-task">
                  <span className="result-task-label">Task created</span>
                  <strong>{TASK_TYPE_LABELS[collectTask.type]}</strong>
                  <span>Due {formatDateTime(collectTask.dueAt)} IST</span>
                </div>
              ) : null}

              {report.result.flaggedForReview ? (
                <Notice tone="info">
                  This submission was flagged for review because the matched lead is
                  already {report.result.status}.
                </Notice>
              ) : null}

              {report.detailError !== undefined ? (
                <Notice tone="error">{report.detailError}</Notice>
              ) : null}

              <Link className="button button-secondary" to={`/leads/${report.result.leadId}`}>
                Open lead
              </Link>
            </Card>
          ) : null}
        </div>

        <aside className="demo-side">
          <section className="panel demo-time-panel" aria-labelledby="demo-time-title">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Pinned clock</p>
                <h2 id="demo-time-title">Demo time</h2>
              </div>
              <span className="panel-total">
                {clock.now === clock.initialNow ? "Pinned" : "Shifted"}
              </span>
            </div>

            <div className="clock-card">
              <span className="clock-label">Current demo time</span>
              <strong>{formatWeekday(clock.now)}</strong>
              <span className="clock-time">{formatDateTime(clock.now)} IST</span>
              <span className="clock-pinned">
                Reset target: {formatDateTime(clock.initialNow)} IST
              </span>
            </div>

            <div className="time-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void shiftClock(HOUR_MS, "one hour", "hour")}
                disabled={busiest}
              >
                {busy === "hour" ? "Advancing..." : "+1 hour"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void shiftClock(DAY_MS, "one day", "day")}
                disabled={busiest}
              >
                {busy === "day" ? "Advancing..." : "+1 day"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void shiftClock(3 * DAY_MS, "three days", "three-days")}
                disabled={busiest}
              >
                {busy === "three-days" ? "Advancing..." : "+3 days"}
              </button>
            </div>

            <button
              className="button button-quiet button-block"
              type="button"
              onClick={() => void resetClock()}
              disabled={busiest || clock.now === clock.initialNow}
            >
              {busy === "pinned" ? "Resetting clock..." : "Reset to pinned time"}
            </button>
          </section>

          <section className="panel overdue-panel" aria-labelledby="overdue-title">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Automation check</p>
                <h2 id="overdue-title">Overdue follow-ups</h2>
              </div>
            </div>

            <div className="overdue-count">
              <strong>{currentOverdue}</strong>
              <span>{pluralize(currentOverdue, "lead")} overdue</span>
            </div>

            <p className="overdue-baseline">
              {overdueDelta === 0
                ? `Unchanged since these controls opened (${pluralize(baseline, "lead")}).`
                : `${overdueDelta > 0 ? "+" : ""}${overdueDelta} since these controls opened (${pluralize(baseline, "lead")}).`}
            </p>

            <button
              className="button button-primary button-block"
              type="button"
              onClick={() => void runOverdueCheck()}
              disabled={busiest}
            >
              {busy === "overdue" ? "Checking..." : "Run overdue check"}
            </button>

            {checkResult !== undefined ? (
              <div className="check-result" aria-live="polite">
                <strong>
                  {checkResult.escalated === 0
                    ? "No new escalations"
                    : `${pluralize(checkResult.escalated, "follow-up")} escalated`}
                </strong>
                <span>
                  {checkResult.escalated === 0
                    ? "All due tasks were already marked overdue."
                    : `${pluralize(checkResult.affectedLeads, "lead")} affected`}
                </span>
                <span>{pluralize(checkResult.overdueLeads, "lead")} now overdue</span>
              </div>
            ) : null}

            <p className="form-note">
              Advance the clock first to pull more follow-up due times into the past.
            </p>
          </section>

          <section className="panel reset-panel" aria-labelledby="reset-title">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Start over</p>
                <h2 id="reset-title">Demo data</h2>
              </div>
            </div>

            <p className="reset-copy">
              Restore the seeded leads, tasks, outbox, activity log, and pinned
              clock.
            </p>
            <Button
              variant="ghost"
              block
              className="button-danger-ghost"
              onClick={() => setConfirmReset(true)}
              disabled={busiest}
            >
              Reset demo data
            </Button>
          </section>
        </aside>
      </div>

      <Modal
        open={confirmReset}
        kicker="Start over"
        title="Reset all demo data?"
        description="This replaces every lead, task, outbox message, and activity entry, and returns the clock to the pinned time."
        onClose={() => {
          if (!busiest) {
            setConfirmReset(false);
          }
        }}
        footer={
          <div className="modal-actions">
            <Button
              variant="danger"
              onClick={() => void confirmResetDemo()}
              disabled={busiest}
            >
              {busy === "reset" ? "Resetting..." : "Yes, reset demo"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmReset(false)}
              disabled={busiest}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <p className="reset-copy">
          Reset only when you want the demo to return to its initial state.
        </p>
      </Modal>
    </div>
  );
}
