import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import type { LeadDetail, LeadStatus } from "../api/types";
import {
  EmptyState,
  LeadAvatar,
  LoadingPanel,
  Notice,
  StatusBadge,
  TaskStatusBadge,
  Toast,
} from "../components/ui";
import { formatDateTime } from "../lib/format";
import {
  displayName,
  ENQUIRY_TYPE_LABELS,
  PREFERRED_CONTACT_LABELS,
  projectTypeCategory,
  SOURCE_LABELS,
  STATUS_LABELS,
  statusOptionsFor,
  TASK_TYPE_LABELS,
  TEAM,
} from "../lib/lookups";

type BusyAction = "" | "status" | "reassign" | "note" | `task:${string}`;

type ToastTone = "success" | "error" | "info";

interface ToastState {
  id: number;
  tone: ToastTone;
  message: string;
}

type StageState = "complete" | "active" | "upcoming" | "closed";

const PROJECT_STAGES = [
  {
    label: "Consultation",
    detail: "Brief, site and budget",
  },
  {
    label: "Design (3D)",
    detail: "Concepts and visualisation",
  },
  {
    label: "Materials",
    detail: "Finishes and fittings",
  },
  {
    label: "Implementation",
    detail: "Site work and install",
  },
  {
    label: "Handover",
    detail: "Final checks and keys",
  },
] as const;

function projectStageIndex(status: LeadStatus): number {
  if (status === "proposal") {
    return 1;
  }

  if (status === "won") {
    return 3;
  }

  if (status === "lost") {
    return -1;
  }

  return 0;
}

function stageState(index: number, activeIndex: number): StageState {
  if (activeIndex === -1) {
    return "closed";
  }

  if (index < activeIndex) {
    return "complete";
  }

  if (index === activeIndex) {
    return "active";
  }

  return "upcoming";
}

function valueOrDash(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? "—" : trimmed;
}

function uppercaseFirst(value: string | undefined): string {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return "—";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function LeadDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<LeadDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState>();
  const [busy, setBusy] = useState<BusyAction>("");
  const [statusDraft, setStatusDraft] = useState<LeadStatus | "">("");
  const [statusNote, setStatusNote] = useState("");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const showToast = useCallback((tone: ToastTone, message: string): void => {
    setToast({ id: Date.now(), tone, message });
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (id === undefined) {
        setError("No lead was selected.");
        setLoading(false);
        return;
      }

      if (!quiet) {
        setLoading(true);
      }

      const result = await api.getLead(id);

      if (!result.ok) {
        setError(result.error.message);
        setLoading(false);
        return;
      }

      setError("");
      setDetail(result.data);

      if (!quiet) {
        const options = statusOptionsFor(result.data.lead.status);
        setStatusDraft(options[0] ?? "");
        setOwnerDraft(result.data.lead.owner ?? "");
      }

      setLoading(false);
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (toast === undefined) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(undefined), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (loading) {
    return (
      <div className="page">
        <LoadingPanel label="Opening the lead record" />
      </div>
    );
  }

  if (detail === undefined) {
    return (
      <div className="page">
        <Link className="back-link" to="/leads">
          ← All leads
        </Link>
        <Notice tone="error">{error || "This lead could not be found."}</Notice>
        <EmptyState
          title="Lead not available"
          body="The record may have been removed by a demo reset."
          action={
            <Link className="button button-secondary" to="/leads">
              Return to leads
            </Link>
          }
        />
      </div>
    );
  }

  const { lead } = detail;
  const statusOptions = statusOptionsFor(lead.status);
  const closed = lead.status === "won" || lead.status === "lost";
  const hasContact = lead.phone !== undefined || lead.email !== undefined;
  const activeStageIndex = projectStageIndex(lead.status);
  const tasks = [...detail.tasks].sort((left, right) => {
    const order: Record<string, number> = {
      overdue: 0,
      in_progress: 1,
      open: 2,
      done: 3,
      cancelled: 4,
    };
    const leftOrder = order[left.status] ?? 9;
    const rightOrder = order[right.status] ?? 9;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.dueAt.localeCompare(right.dueAt);
  });
  const openTaskCount = detail.tasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  ).length;
  const messages = [...detail.outboxMessages].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const activity = [...detail.activityLog].sort((left, right) =>
    right.at.localeCompare(left.at),
  );
  const actionInFlight = busy !== "";
  const enquiryTypeLabel =
    lead.enquiryType === undefined ? undefined : ENQUIRY_TYPE_LABELS[lead.enquiryType];
  const projectCategory = projectTypeCategory(lead.projectType);
  const stageLabel =
    activeStageIndex === -1
      ? `Closed · ${STATUS_LABELS[lead.status]}`
      : PROJECT_STAGES[activeStageIndex]?.label;

  async function saveStatus(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (closed) {
      showToast("info", "This lead is closed. Add a note to record any further detail.");
      return;
    }

    if (statusDraft === "") {
      showToast("error", "Choose the next status first.");
      return;
    }

    setBusy("status");
    const result = await api.updateStatus(
      lead.id,
      statusDraft,
      statusNote.trim().length > 0 ? statusNote.trim() : undefined,
    );

    if (!result.ok) {
      showToast("error", result.error.message);
    } else {
      const options = statusOptionsFor(result.data.lead.status);
      setDetail(result.data);
      setStatusDraft(options[0] ?? "");
      setStatusNote("");
      setOwnerDraft(result.data.lead.owner ?? "");
      showToast("success", `Lead moved to ${STATUS_LABELS[result.data.lead.status]}.`);
    }

    setBusy("");
  }

  async function reassign(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (closed) {
      showToast("info", "Closed leads cannot be reassigned. Add a note instead.");
      return;
    }

    const nextOwner = ownerDraft.trim();
    if (nextOwner.length === 0) {
      showToast("error", "Enter an owner before reassigning.");
      return;
    }

    if ((lead.owner ?? "").trim().toLowerCase() === nextOwner.toLowerCase()) {
      showToast("info", `${nextOwner} is already the owner. No change was saved.`);
      return;
    }

    setBusy("reassign");
    const result = await api.reassign(lead.id, nextOwner);

    if (!result.ok) {
      showToast("error", result.error.message);
    } else {
      setDetail(result.data);
      setOwnerDraft(result.data.lead.owner ?? "");
      showToast("success", `Lead assigned to ${result.data.lead.owner}.`);
    }

    setBusy("");
  }

  async function addNote(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (noteDraft.trim().length === 0) {
      showToast("error", "Write a note before saving.");
      return;
    }

    setBusy("note");
    const result = await api.addNote(lead.id, noteDraft.trim());

    if (!result.ok) {
      showToast("error", result.error.message);
    } else {
      setNoteDraft("");
      showToast("success", "Note added to the lead record.");
      await load(true);
    }

    setBusy("");
  }

  async function completeTask(taskId: string): Promise<void> {
    if (closed) {
      showToast("info", "Closed leads are read-only. Add a note instead.");
      return;
    }

    const task = detail?.tasks.find((candidate) => candidate.id === taskId);
    setBusy(`task:${taskId}`);
    const result = await api.completeTask(taskId);

    if (!result.ok) {
      showToast("error", result.error.message);
    } else {
      showToast(
        "success",
        task === undefined
          ? "Follow-up marked complete."
          : `${TASK_TYPE_LABELS[task.type]} task marked complete.`,
      );
      await load(true);
    }

    setBusy("");
  }

  return (
    <div className="page">
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast === undefined ? null : (
          <Toast
            tone={toast.tone}
            message={toast.message}
            onDismiss={() => setToast(undefined)}
          />
        )}
      </div>

      <Link className="back-link" to="/leads">
        ← All leads
      </Link>

      <header className="detail-heading">
        <div className="detail-identity">
          <LeadAvatar name={displayName(lead)} owner={lead.owner} />
          <div>
            <p className="eyebrow">
              {lead.id} · {SOURCE_LABELS[lead.source]}
            </p>
            <h1>{displayName(lead)}</h1>
            <div className="detail-badges">
              <StatusBadge status={lead.status} />
              {enquiryTypeLabel !== undefined ? (
                <span className="detail-chip">{enquiryTypeLabel}</span>
              ) : null}
              {projectCategory !== undefined ? (
                <span className="detail-chip">{projectCategory}</span>
              ) : null}
              {lead.location !== undefined ? (
                <span className="detail-chip">{lead.location}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="detail-activity-stamp">
          <span>Last activity</span>
          <strong>{formatDateTime(lead.lastActivity)}</strong>
        </div>
      </header>

      {!hasContact ? (
        <Notice tone="info">
          No phone number or email is on file. Add contact details as a note before
          outreach.
        </Notice>
      ) : null}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel next-move-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Next move</p>
                <h2>{lead.nextAction ?? "Review the enquiry."}</h2>
              </div>
            </div>
            <div className="next-move-meta">
              <span>
                <small>Owner</small>
                <strong>{lead.owner ?? "Unassigned"}</strong>
              </span>
              <span>
                <small>Budget</small>
                <strong>{lead.budgetRange ?? "—"}</strong>
              </span>
              <span>
                <small>Timeline</small>
                <strong>{lead.timeline ?? "—"}</strong>
              </span>
            </div>
          </section>

          <section className="panel stage-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Project stage</p>
                <h2>Delivery journey</h2>
              </div>
              <span className={`stage-pill stage-pill-${closed ? "closed" : "active"}`}>
                {stageLabel}
              </span>
            </div>
            <ol
              className={`stage-track${closed ? " stage-track-closed" : ""}`}
              aria-label="Project stage tracker"
            >
              {PROJECT_STAGES.map((stage, index) => {
                const state = stageState(index, activeStageIndex);

                return (
                  <li
                    className={`stage-step stage-step-${state}`}
                    key={stage.label}
                    aria-current={state === "active" ? "step" : undefined}
                  >
                    <span className="stage-marker">{index + 1}</span>
                    <span className="stage-copy">
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="stage-note">
              {closed
                ? "The enquiry is closed, so the project tracker is not advancing."
                : "Derived from the lead status. The full design process continues after the sale."}
            </p>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Record</p>
                <h2>Enquiry details</h2>
              </div>
              <span className="panel-meta">{lead.id}</span>
            </div>
            <div className="detail-facts">
              <div className="fact-group">
                <p className="fact-group-label">Contact</p>
                <div className="detail-list">
                  <Fact label="Email">{valueOrDash(lead.email)}</Fact>
                  <Fact label="Phone">{valueOrDash(lead.phone)}</Fact>
                  <Fact label="Preferred">
                    {lead.preferredContactMethod === undefined
                      ? "—"
                      : PREFERRED_CONTACT_LABELS[lead.preferredContactMethod]}
                  </Fact>
                  <Fact label="Enquiry type">{valueOrDash(enquiryTypeLabel)}</Fact>
                </div>
              </div>

              <div className="fact-group">
                <p className="fact-group-label">Project</p>
                <div className="detail-list">
                  <Fact label="Project type">{valueOrDash(projectCategory)}</Fact>
                  <Fact label="Property">{uppercaseFirst(lead.propertyType)}</Fact>
                  <Fact label="Location">{valueOrDash(lead.location)}</Fact>
                  <Fact label="Home size">{valueOrDash(lead.size)}</Fact>
                  <Fact label="Budget">{valueOrDash(lead.budgetRange)}</Fact>
                  <Fact label="Timeline">{valueOrDash(lead.timeline)}</Fact>
                </div>
              </div>

              <div className="fact-group">
                <p className="fact-group-label">Record</p>
                <div className="detail-list">
                  <Fact label="Source">{SOURCE_LABELS[lead.source]}</Fact>
                  <Fact label="Owner">{valueOrDash(lead.owner)}</Fact>
                  <Fact label="Created">{formatDateTime(lead.createdAt)}</Fact>
                  <Fact label="Updated">{formatDateTime(lead.updatedAt)}</Fact>
                  <Fact label="Last activity">{formatDateTime(lead.lastActivity)}</Fact>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Automation</p>
                <h2>Follow-ups</h2>
              </div>
              <span className="panel-meta">
                {closed ? "Read-only" : `${openTaskCount} open`}
              </span>
            </div>

            {tasks.length === 0 ? (
              <p className="panel-empty">No follow-up tasks are attached to this lead.</p>
            ) : (
              <ul className="task-list">
                {tasks.map((task) => {
                  const active =
                    task.status === "open" ||
                    task.status === "in_progress" ||
                    task.status === "overdue";

                  return (
                    <li className="task-row" key={task.id}>
                      <span className="task-marker" aria-hidden="true" />
                      <div className="task-copy">
                        <strong>{TASK_TYPE_LABELS[task.type]}</strong>
                        <span>
                          Due {formatDateTime(task.dueAt)} · {task.assignee}
                        </span>
                      </div>
                      <TaskStatusBadge status={task.status} />
                      {active ? (
                        <button
                          className="button button-quiet button-small"
                          type="button"
                          onClick={() => void completeTask(task.id)}
                          disabled={actionInFlight || closed}
                          title={
                            closed ? "Closed leads are read-only." : undefined
                          }
                        >
                          {busy === `task:${task.id}` ? "Saving..." : "Complete"}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Message queue</p>
                <h2>Outbox</h2>
              </div>
              <span className="demo-badge">Simulated · not sent</span>
            </div>
            <p className="outbox-note">
              Demo messages only. No email, SMS, or WhatsApp message is actually sent.
            </p>

            {messages.length === 0 ? (
              <p className="panel-empty">No messages have been queued for this lead.</p>
            ) : (
              <div className="outbox-list">
                {messages.map((message) => (
                  <article className="outbox-item" key={message.id}>
                    <div className="outbox-top">
                      <span className={`channel channel-${message.channel}`}>
                        {message.channel.replaceAll("_", " ")}
                      </span>
                      <span className="queue-badge">{message.status}</span>
                      <span className="outbox-time">
                        {formatDateTime(message.createdAt)}
                      </span>
                    </div>
                    {message.subject !== undefined ? (
                      <strong className="outbox-subject">{message.subject}</strong>
                    ) : null}
                    <p>{message.body}</p>
                    <span className="outbox-recipient">To {message.recipient}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Record</p>
                <h2>Activity</h2>
              </div>
              <span className="panel-meta">{detail.activityLog.length} entries</span>
            </div>

            {activity.length === 0 ? (
              <p className="panel-empty">No activity has been logged yet.</p>
            ) : (
              <ol className="timeline">
                {activity.map((entry) => (
                  <li key={entry.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <p>{entry.message}</p>
                      <span>
                        {formatDateTime(entry.at)}
                        {entry.actor !== undefined ? ` · ${entry.actor}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="detail-aside">
          <section className="panel action-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Pipeline</p>
                <h2>Move the lead</h2>
              </div>
            </div>

            {statusOptions.length === 0 ? (
              <p className="panel-empty">
                This lead is closed as <strong>{STATUS_LABELS[lead.status]}</strong>. No
                further status changes are available.
              </p>
            ) : (
              <form className="stack-form" onSubmit={(event) => void saveStatus(event)}>
                <label className="field">
                  <span>Next status</span>
                  <select
                    value={statusDraft}
                    onChange={(event) => setStatusDraft(event.target.value as LeadStatus)}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>
                    Status note <small>optional</small>
                  </span>
                  <textarea
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    rows={2}
                    placeholder="Context for the change..."
                  />
                </label>
                <button
                  className="button button-primary button-block"
                  type="submit"
                  disabled={actionInFlight}
                >
                  {busy === "status" ? "Updating..." : "Update status"}
                </button>
              </form>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Ownership</p>
                <h2>Assigned to</h2>
              </div>
            </div>
            <form className="stack-form" onSubmit={(event) => void reassign(event)}>
              <label className="field">
                <span>Owner</span>
                <input
                  list="haika-team"
                  value={ownerDraft}
                  onChange={(event) => setOwnerDraft(event.target.value)}
                  placeholder="Unassigned"
                  disabled={closed}
                />
                <datalist id="haika-team">
                  {TEAM.map((member) => (
                    <option key={member} value={member} />
                  ))}
                </datalist>
              </label>
              <button
                className="button button-secondary button-block"
                type="submit"
                disabled={actionInFlight || closed}
              >
                {busy === "reassign" ? "Reassigning..." : "Reassign lead"}
              </button>
              {closed ? (
                <p className="form-note">Reassignment is disabled for closed leads.</p>
              ) : null}
            </form>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Desk notes</p>
                <h2>Add a note</h2>
              </div>
            </div>
            <form className="stack-form" onSubmit={(event) => void addNote(event)}>
              <label className="field">
                <span className="visually-hidden">Note</span>
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={3}
                  placeholder="What happened on this enquiry?"
                />
              </label>
              <button
                className="button button-secondary button-block"
                type="submit"
                disabled={actionInFlight}
              >
                {busy === "note" ? "Saving..." : "Save note"}
              </button>
            </form>
            <div className="notes-block">
              <span>Existing notes</span>
              <p>{lead.notes ?? "No notes have been added yet."}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
