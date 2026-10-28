import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import type { Lead, LeadFilters, LeadSource, LeadStatus } from "../api/types";
import {
  Button,
  EmptyState,
  LeadAvatar,
  LoadingPanel,
  Notice,
  StatusBadge,
  Table,
} from "../components/ui";
import { formatDateTime } from "../lib/format";
import {
  displayName,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  SOURCE_LABELS,
  TEAM,
} from "../lib/lookups";

type SortDirection = "asc" | "desc";

function hasContact(lead: Lead): boolean {
  return (
    (lead.phone?.trim().length ?? 0) > 0 ||
    (lead.email?.trim().length ?? 0) > 0
  );
}

function activityValue(lead: Lead): number {
  const value = lead.lastActivity ?? lead.updatedAt ?? lead.createdAt;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function filtersFromParams(params: URLSearchParams): LeadFilters {
  const filters: LeadFilters = {};
  const status = params.get("status");
  const source = params.get("source");
  const owner = params.get("owner");
  const search = params.get("search");
  const overdue = params.get("overdue");

  if (LEAD_STATUS_OPTIONS.some((option) => option.value === status)) {
    filters.status = status as LeadStatus;
  }

  if (LEAD_SOURCE_OPTIONS.some((option) => option.value === source)) {
    filters.source = source as LeadSource;
  }

  if (owner !== null && owner.trim().length > 0) {
    filters.owner = owner;
  }

  if (search !== null && search.trim().length > 0) {
    filters.search = search;
  }

  if (overdue === "true" || overdue === "false") {
    filters.overdue = overdue === "true";
  }

  return filters;
}

export function LeadsPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<LeadFilters>(() =>
    filtersFromParams(searchParams),
  );
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("search") ?? "",
  );
  const [leads, setLeads] = useState<Lead[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<string[]>([...TEAM]);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    void api.listLeads(filters).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setError(result.error.message);
        setLoading(false);
        return;
      }

      setLeads(result.data);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    void api.listLeads().then((result) => {
      if (cancelled || !result.ok) {
        return;
      }

      const owners = new Set<string>(TEAM);

      for (const lead of result.data) {
        if (lead.owner !== undefined && lead.owner.trim().length > 0) {
          owners.add(lead.owner);
        }
      }

      setOwnerOptions([...owners].sort((left, right) => left.localeCompare(right)));
    });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const sortedLeads = useMemo(() => {
    return [...leads].sort((left, right) => {
      const difference = activityValue(left) - activityValue(right);

      if (difference !== 0) {
        return sortDirection === "asc" ? difference : -difference;
      }

      return sortDirection === "asc"
        ? left.id.localeCompare(right.id)
        : right.id.localeCompare(left.id);
    });
  }, [leads, sortDirection]);

  const filterCount = [
    filters.status,
    filters.source,
    filters.owner,
    filters.overdue,
    filters.search,
  ].filter((value) => value !== undefined && value !== "").length;

  function applySearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = searchInput.trim();
    setFilters((current) => ({
      ...current,
      search: value.length > 0 ? value : undefined,
    }));
  }

  function clearFilters(): void {
    setSearchInput("");
    setFilters({});
  }

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>Leads</h1>
          <p className="page-lede">
            Every enquiry in one place — filter the desk, open a record and move the
            conversation forward.
          </p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Refresh
          </Button>
        </div>
      </header>

      <form className="filter-bar" onSubmit={applySearch}>
        <label className="search-field">
          <span className="visually-hidden">Search leads</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.7" cy="8.7" r="5.3" />
            <path d="m12.7 12.7 4 4" />
          </svg>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, project, location, budget..."
          />
        </label>

        <label className="select-field">
          <span className="visually-hidden">Filter by status</span>
          <select
            value={filters.status ?? ""}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: (event.target.value || undefined) as LeadStatus | undefined,
              }))
            }
          >
            <option value="">All statuses</option>
            {LEAD_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span className="visually-hidden">Filter by owner</span>
          <select
            value={filters.owner ?? ""}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                owner: event.target.value || undefined,
              }))
            }
          >
            <option value="">All owners</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span className="visually-hidden">Filter by source</span>
          <select
            value={filters.source ?? ""}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                source: (event.target.value || undefined) as LeadSource | undefined,
              }))
            }
          >
            <option value="">All sources</option>
            {LEAD_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="select-field">
          <span className="visually-hidden">Filter by follow-up</span>
          <select
            value={
              filters.overdue === true
                ? "true"
                : filters.overdue === false
                  ? "false"
                  : ""
            }
            onChange={(event) => {
              const value = event.target.value;
              setFilters((current) => ({
                ...current,
                overdue: value === "" ? undefined : value === "true",
              }));
            }}
          >
            <option value="">All follow-ups</option>
            <option value="true">Overdue only</option>
            <option value="false">On track</option>
          </select>
        </label>

        <div className="filter-actions">
          <Button variant="primary" type="submit">
            Search
          </Button>
          {filterCount > 0 || searchInput.length > 0 ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      {error.length > 0 && leads.length > 0 ? (
        <Notice tone="error">{error}</Notice>
      ) : null}

      <section className="panel leads-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Lead register</p>
            <h2>
              {loading
                ? "Loading leads"
                : `${sortedLeads.length} ${
                    sortedLeads.length === 1 ? "lead" : "leads"
                  }`}
            </h2>
          </div>
          <span className="panel-meta">
            {filters.overdue === true
              ? "Overdue follow-ups"
              : `${sortDirection === "desc" ? "Newest" : "Oldest"} activity first`}
          </span>
        </div>

        {loading ? (
          <LoadingPanel label="Reading the lead register" />
        ) : error.length > 0 && leads.length === 0 ? (
          <EmptyState
            title="Could not load leads"
            body={error}
            action={
              <Button
                variant="secondary"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                Try again
              </Button>
            }
          />
        ) : sortedLeads.length === 0 ? (
          <EmptyState
            title="No leads match"
            body="Try a wider search or clear the filters to see the full register."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <Table className="leads-table">
              <thead>
                <tr>
                  <th scope="col">Lead</th>
                  <th scope="col">Project type</th>
                  <th scope="col">Location</th>
                  <th scope="col">Budget</th>
                  <th scope="col">Status</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Next action</th>
                  <th
                    scope="col"
                    aria-sort={sortDirection === "asc" ? "ascending" : "descending"}
                  >
                    <button
                      className="sort-button"
                      type="button"
                      onClick={() =>
                        setSortDirection((current) =>
                          current === "desc" ? "asc" : "desc",
                        )
                      }
                    >
                      Last activity
                      <span aria-hidden="true">
                        {sortDirection === "desc" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                  <th scope="col">Source</th>
                  <th scope="col">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead) => {
                  const noContact = !hasContact(lead);
                  const closed = lead.status === "won" || lead.status === "lost";

                  return (
                    <tr className={closed ? "lead-row-closed" : undefined} key={lead.id}>
                      <td>
                        <Link className="table-lead" to={`/leads/${lead.id}`}>
                          <LeadAvatar
                            name={displayName(lead)}
                            owner={lead.owner}
                            size="small"
                          />
                          <span>
                            <strong>{lead.name ?? "—"}</strong>
                            <small>{lead.email ?? lead.phone ?? lead.id}</small>
                            {noContact ? (
                              <small className="no-contact-flag">No contact</small>
                            ) : null}
                          </span>
                        </Link>
                      </td>
                      <td className="capitalize">{lead.projectType ?? "—"}</td>
                      <td>{lead.location ?? "—"}</td>
                      <td className="nowrap">{lead.budgetRange ?? "—"}</td>
                      <td>
                        <StatusBadge status={lead.status} />
                      </td>
                      <td>{lead.owner ?? "—"}</td>
                      <td className="next-action-cell">
                        {lead.nextAction ?? "—"}
                      </td>
                      <td className="nowrap">
                        {lead.lastActivity === undefined
                          ? "—"
                          : formatDateTime(lead.lastActivity)}
                      </td>
                      <td>{SOURCE_LABELS[lead.source]}</td>
                      <td>
                        <Link
                          className="row-action"
                          to={`/leads/${lead.id}`}
                          aria-label={`Open ${displayName(lead)}`}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M4 10h12M11 5l5 5-5 5" />
                          </svg>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
