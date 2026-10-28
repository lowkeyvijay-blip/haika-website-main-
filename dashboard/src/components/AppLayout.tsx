import { Link, NavLink, Outlet } from "react-router-dom";

function OverviewIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="0.8" />
      <rect x="12" y="3" width="5" height="5" rx="0.8" />
      <rect x="3" y="12" width="5" height="5" rx="0.8" />
      <rect x="12" y="12" width="5" height="5" rx="0.8" />
    </svg>
  );
}

function LeadsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8" cy="7" r="2.6" />
      <path d="M3.2 16c0-3 2.1-5 4.8-5s4.8 2 4.8 5" />
      <path d="M13 5.2a2.4 2.4 0 0 1 0 4.6" />
      <path d="M14 11.6c1.8.4 2.9 2 2.9 4.4" />
    </svg>
  );
}

function DemoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.4v7.2M6.4 10h7.2" />
      <path d="M6 3.8h8" />
    </svg>
  );
}

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function AppLayout(): React.JSX.Element {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="Haika Studio home">
          <span className="brand-mark" aria-hidden="true">
            H
          </span>
          <span className="brand-copy">
            <strong>Haika</strong>
            <small>Interior studio</small>
          </span>
        </Link>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          <NavLink to="/" end className={navClassName}>
            <OverviewIcon />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/leads" className={navClassName}>
            <LeadsIcon />
            <span>Leads</span>
          </NavLink>
          <NavLink to="/demo" className={navClassName}>
            <DemoIcon />
            <span>Demo controls</span>
          </NavLink>
        </nav>

        <div className="sidebar-note">
          <span className="sidebar-note-label">
            <span className="live-dot" aria-hidden="true" />
            Demo workspace
          </span>
          <p>Local sample data. Automation runs on a pinned studio clock.</p>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <span className="topbar-kicker">Haika Studio</span>
            <span className="topbar-title">Lead operations</span>
          </div>
          <div className="topbar-meta">
            <span className="topbar-pill">
              <span className="live-dot" aria-hidden="true" />
              Local demo
            </span>
            <span className="avatar avatar-small" aria-hidden="true">
              HA
            </span>
          </div>
        </header>

        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
