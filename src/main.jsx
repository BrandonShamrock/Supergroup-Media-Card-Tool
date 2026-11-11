import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CarFront,
  Users,
  Send,
  History,
  Settings,
  ChevronDown,
  ArrowRight,
  Plus,
  RefreshCw,
  Search,
  LogOut,
  ShieldCheck,
  Menu,
  X,
  CheckCircle2,
} from "lucide-react";
import { AuthGate } from "./Auth";
import { api } from "./api";
const CustomerUpload = lazy(() => import("./CustomerUpload"));
const DealershipSettings = lazy(() => import("./DealershipSettings"));
const CampaignPreview = lazy(() => import("./CampaignPreview"));
import "./styles.css";

const navigation = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Vehicle stock", icon: CarFront },
  { name: "Client upload", icon: Users },
  { name: "Campaign preview", icon: Send },
  { name: "Campaign history", icon: History },
  { name: "Dealership settings", icon: Settings },
];
function Brand() {
  return (
    <div className="brand">
      <div className="brand-symbol">
        S<span>G</span>
      </div>
      <div>
        <strong>SUPER GROUP</strong>
        <small>MEDIA CARD TOOL</small>
      </div>
    </div>
  );
}
function Button({ children, secondary = false, ...props }) {
  return (
    <button className={`button ${secondary ? "secondary" : ""}`} {...props}>
      {children}
    </button>
  );
}
function Heading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
const money = (v) =>
  Number(v).toLocaleString("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  });
const date = (v) =>
  v
    ? new Date(v).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })
    : "Never";
function Dashboard({ session, signOut }) {
  const [page, setPage] = useState("Overview"),
    [data, setData] = useState({
      dealerships: [],
      vehicles: [],
      campaigns: [],
      sync: {},
      sending: { enabled: false },
    }),
    [dealer, setDealer] = useState(""),
    [selected, setSelected] = useState([]),
    [failedImages, setFailedImages] = useState([]),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [diagnosing, setDiagnosing] = useState(false),
    [audience, setAudience] = useState(null),
    [details, setDetails] = useState(null);
  const load = async () => {
    const result = await api("dashboard");
    setData(result);
    setFailedImages([]);
    setDealer((current) =>
      result.dealerships.some((d) => d.id === current)
        ? current
        : result.dealerships[0]?.id || "",
    );
    setSelected((current) =>
      current.filter((id) =>
        result.vehicles.some((v) => v.source_id === id && v.primary_image_url),
      ),
    );
  };
  useEffect(() => {
    let active = true;
    api("dashboard")
      .then((r) => {
        if (active) {
          setData(r);
          setDealer(r.dealerships[0]?.id || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (page !== "Campaign history") return;
    const timer = setInterval(() => {
      load().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    if (!["queued", "running"].includes(data.sync.status)) return;
    let active = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { sync } = await api("stock-status");
        if (!active) return;
        if (sync.status === "succeeded") {
          await load();
          if (active)
            setNotice(
              `Stock synchronized: ${sync.vehicle_count} vehicles. Job ${sync.job_id}.`,
            );
        } else if (sync.status === "failed") {
          setData((current) => ({ ...current, sync }));
          setError(`${sync.error_code}: ${sync.error} Job ${sync.job_id}.`);
        } else {
          setData((current) => ({ ...current, sync }));
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data.sync.status, data.sync.job_id]);
  const syncActive = ["queued", "running"].includes(data.sync.status);
  const config = data.dealerships.find((d) => d.id === dealer);
  const vehicles = data.vehicles.filter(
    (v) => v.dealership_id === config?.dealeros_id,
  );
  const chosen = selected
    .map((id) => vehicles.find((v) => v.source_id === id))
    .filter(Boolean);
  const navigate = (next) => {
    setPage(next);
    setMobile(false);
    setNotice("");
    setDetails(null);
  };
  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((v) => v !== id) : [...s, id],
    );
  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const r = await api("refresh", {});
      const { sync } = await api("stock-status");
      setData((current) => ({ ...current, sync }));
      if (sync.status === "succeeded") {
        await load();
        setNotice(
          `Stock synchronized: ${sync.vehicle_count} vehicles. Job ${sync.job_id}.`,
        );
      } else if (sync.status === "failed") {
        setError(`${sync.error_code}: ${sync.error} Job ${sync.job_id}.`);
      } else {
        setNotice(
          `Stock refresh accepted (job ${r.job_id}). The background worker will report completion here; it is safe to close the browser.`,
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };
  const diagnose = async () => {
    setDiagnosing(true);
    setError("");
    try {
      const result = await api("diagnose-stock", {});
      setNotice(
        `DealerOS diagnostic queued: ${result.diagnostic_id}. Inspect dealeros-diagnostic-background in Netlify function logs. Acceptance is not a successful connectivity result. Allow up to 90 seconds.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setDiagnosing(false);
    }
  };
  const save = async (form) => {
    await api("settings", form);
    await load();
    setSelected([]);
    setNotice("Dealership configuration saved.");
  };
  const cancel = async (id) => {
    if (
      !window.confirm(
        "Cancel pending batches? Any in-flight submission may still finish and cannot be recalled.",
      )
    )
      return;
    try {
      await api("cancel", { id });
      await load();
      setNotice(
        "Pending batches cancelled. In-flight submissions may still finish.",
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const inspect = async (id) => {
    try {
      setDetails(await api(`details&id=${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e.message);
    }
  };
  const nextReady =
    config?.active &&
    config?.mapping_verified &&
    config?.template_verified &&
    chosen.length === config?.card_count;
  return (
    <div className="app">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Brand />
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X />
        </button>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              {name}
              {name === "Vehicle stock" && (
                <span className="nav-count">{vehicles.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <ShieldCheck size={20} />
            <strong> A considered connection</strong>
            <p>
              Verify your mapping, approved template and audience consent before
              submitting a campaign.
            </p>
            <button onClick={() => navigate("Dealership settings")}>
              Manage dealership settings <ArrowRight size={15} />
            </button>
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" />
            {data.sending.enabled
              ? "Live sending enabled"
              : "Live sending disabled"}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="prototype-pill">
              {data.sending.enabled ? "Live workflow" : "Sending disabled"}
            </span>
            <div className="user-avatar">
              {(session.user.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="user-name">
              <strong>{session.user.email || "Signed-in user"}</strong>
              <small>Authenticated account</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          <div className="dealer-row">
            <span>
              <span className="tiny-square" /> DEALERSHIP WORKSPACE
            </span>
            <label className="dealer-select">
              <CarFront size={17} />
              <select
                aria-label="Select dealership"
                value={dealer}
                onChange={(e) => {
                  setDealer(e.target.value);
                  setSelected([]);
                  setDetails(null);
                }}
              >
                <option disabled value="">
                  No dealership configured
                </option>
                {data.dealerships.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {!d.active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          {loading && <p role="status">Loading your workspace…</p>}
          {syncActive && (
            <div className="notice" role="status">
              Stock refresh {data.sync.status} · {data.sync.phase} · Job{" "}
              {data.sync.job_id}. Large feeds can take several minutes.
              Completion is confirmed by the database, not the initial
              acceptance response.
            </div>
          )}
          {data.sync.status === "failed" && (
            <div className="alert" role="alert">
              {data.sync.error_code}: {data.sync.error} Job {data.sync.job_id}.
            </div>
          )}
          {error && (
            <div className="notice form-error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
              <Button
                secondary
                onClick={() => {
                  load()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message));
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <>
              <Heading
                eyebrow="LET’S GET THINGS MOVING"
                title="Your next campaign starts here."
                description="Turn your vehicle stock into meaningful customer connections."
              >
                <Button onClick={() => navigate("Vehicle stock")}>
                  <Plus size={18} /> Create campaign
                </Button>
              </Heading>
              <div className="stats-grid">
                {[
                  {
                    label: "Available vehicles",
                    value: vehicles.length,
                    note: config?.name || "Select a dealership",
                    icon: CarFront,
                  },
                  {
                    label: "Selected vehicles",
                    value: chosen.length,
                    note: `${config?.card_count || "—"} required by template`,
                    icon: CheckCircle2,
                  },
                  {
                    label: "Client audience",
                    value: audience?.recipients.length || 0,
                    note: "Validated recipients in this session",
                    icon: Users,
                  },
                  {
                    label: "Campaigns",
                    value: data.campaigns.length,
                    note: "Most recent 100 campaigns",
                    icon: Send,
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <div className="stat-icon">
                        <s.icon size={20} />
                      </div>
                    </div>
                    <div className="stat-value">{s.value}</div>
                    <div className="stat-note">{s.note}</div>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="campaign-guide">
                  <div className="section-kicker">FROM STOCK TO SPOTLIGHT</div>
                  <h2>
                    A great campaign.
                    <br /> Three simple steps.
                  </h2>
                  <p>Prepare a considered selection for your customers.</p>
                  <div className="steps">
                    {[
                      {
                        n: "01",
                        title: "Choose your vehicles",
                        text: "Select fresh stock for your dealership.",
                        page: "Vehicle stock",
                      },
                      {
                        n: "02",
                        title: "Add your audience",
                        text: "Import and validate your customer spreadsheet.",
                        page: "Client upload",
                      },
                      {
                        n: "03",
                        title: "Review and confirm",
                        text: "Check cards, audience and template before queuing.",
                        page: "Campaign preview",
                      },
                    ].map((s) => (
                      <button
                        className="step"
                        key={s.n}
                        onClick={() => navigate(s.page)}
                      >
                        <span className="step-number">{s.n}</span>
                        <div>
                          <strong>{s.title}</strong>
                          <small>{s.text}</small>
                        </div>
                        <ArrowRight size={18} />
                      </button>
                    ))}
                  </div>
                  <div className="guide-foot">
                    <ShieldCheck size={16} /> Server validation protects every
                    submission.
                  </div>
                </section>
                <section className="panel recent-panel">
                  <div className="section-header">
                    <div>
                      <h2>Recent campaigns</h2>
                      <p>Actual submission activity</p>
                    </div>
                  </div>
                  <div className="recent-list">
                    {data.campaigns.slice(0, 3).map((c) => (
                      <div className="recent-item" key={c.id}>
                        <div className="recent-icon">
                          <Send size={19} />
                        </div>
                        <div className="recent-copy">
                          <strong>{c.name}</strong>
                          <small>
                            {c.recipient_count} recipients ·{" "}
                            {date(c.created_at)}
                          </small>
                          <span>
                            {c.accepted_count} accepted · {c.unknown_count}{" "}
                            unknown
                          </span>
                        </div>
                        <span className="badge">{c.status}</span>
                      </div>
                    ))}
                    {!data.campaigns.length && (
                      <p className="empty-state">
                        No campaigns yet. Prepare a selection to get started.
                      </p>
                    )}
                  </div>
                  <button
                    className="text-button full"
                    onClick={() => navigate("Campaign history")}
                  >
                    View campaign history <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <section className="panel">
                <div className="section-header">
                  <div>
                    <h2>Stock synchronization</h2>
                    <p>
                      Last successful refresh: {date(data.sync.last_success_at)}{" "}
                      · {data.sync.vehicle_count || 0} total vehicles
                    </p>
                  </div>
                  <Button
                    secondary
                    disabled={refreshing || syncActive}
                    onClick={refresh}
                  >
                    <RefreshCw size={16} />
                    {refreshing || syncActive ? "Refreshing…" : "Refresh stock"}
                  </Button>
                </div>
                {data.sync.error && (
                  <p className="form-error padded">{data.sync.error}</p>
                )}
              </section>
            </>
          )}
          {page === "Vehicle stock" && (
            <>
              <Heading
                eyebrow="FIND YOUR NEXT FEATURE"
                title="Vehicle stock"
                description="Select vehicles in the order you want them to appear in the carousel."
              >
                <Button
                  secondary
                  disabled={
                    refreshing ||
                    syncActive ||
                    new Date(data.sync.lease_until) > new Date()
                  }
                  onClick={refresh}
                >
                  <RefreshCw size={17} />
                  {refreshing || syncActive ? "Refreshing…" : "Refresh stock"}
                </Button>
              </Heading>
              <Button
                secondary
                disabled={diagnosing || syncActive || refreshing}
                onClick={diagnose}
              >
                {diagnosing
                  ? "Queuing diagnostic…"
                  : "Test DealerOS connection"}
              </Button>
              <p className="stock-status">
                Last refresh: {date(data.sync.last_success_at)} ·{" "}
                {data.sync.vehicle_count || 0} vehicles across all dealerships
                {data.sync.lease_until &&
                new Date(data.sync.lease_until) > new Date()
                  ? " · Synchronization running"
                  : ""}
              </p>
              {data.sync.error && (
                <div className="alert">{data.sync.error}</div>
              )}
              {!config?.dealeros_id && (
                <div className="alert">
                  Map this dealership to the actual DealerOS feed in Dealership
                  Settings.
                </div>
              )}
              <div className="panel">
                <div className="stock-toolbar">
                  <label className="search">
                    <Search size={18} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search make, model or stock number"
                      aria-label="Search vehicles"
                    />
                  </label>
                  <span>
                    {chosen.length} selected · {config?.card_count || "—"}{" "}
                    required
                  </span>
                  <Button
                    disabled={!nextReady}
                    onClick={() => navigate("Campaign preview")}
                  >
                    Preview selection <ArrowRight size={16} />
                  </Button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>SELECT / ORDER</th>
                        <th>VEHICLE</th>
                        <th>YEAR</th>
                        <th>MILEAGE</th>
                        <th>PRICE</th>
                        <th>CONDITION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles
                        .filter((v) =>
                          [v.make, v.model, v.derivative, v.stock_number]
                            .join(" ")
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((v) => (
                          <tr
                            key={v.source_id}
                            className={
                              selected.includes(v.source_id)
                                ? "selected-row"
                                : ""
                            }
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.includes(v.source_id)}
                                disabled={
                                  !v.primary_image_url ||
                                  failedImages.includes(v.primary_image_url) ||
                                  (!selected.includes(v.source_id) &&
                                    chosen.length >= (config?.card_count || 10))
                                }
                                onChange={() => toggle(v.source_id)}
                                aria-label={`Select ${v.make} ${v.model}`}
                              />
                              {selected.includes(v.source_id) && (
                                <span>
                                  {" "}
                                  #{selected.indexOf(v.source_id) + 1}
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="vehicle-cell">
                                {v.primary_image_url &&
                                !failedImages.includes(v.primary_image_url) ? (
                                  <img
                                    src={v.primary_image_url}
                                    onError={() => {
                                      setFailedImages((current) => [
                                        ...new Set([
                                          ...current,
                                          v.primary_image_url,
                                        ]),
                                      ]);
                                      setSelected((current) =>
                                        current.filter(
                                          (id) => id !== v.source_id,
                                        ),
                                      );
                                    }}
                                    referrerPolicy="no-referrer"
                                    alt={`${v.make} ${v.model}`}
                                  />
                                ) : (
                                  <span className="form-error">
                                    Primary image unavailable
                                  </span>
                                )}
                                <div>
                                  <strong>
                                    {v.make} {v.model}
                                  </strong>
                                  <span>{v.derivative}</span>
                                  <small>
                                    {v.stock_number} · {v.colour}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>{v.year}</td>
                            <td>{Number(v.mileage).toLocaleString()} km</td>
                            <td className="price">{money(v.retail_price)}</td>
                            <td>{v.new_used}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!vehicles.length && (
                    <div className="empty-state">
                      No stock for this dealership. Refresh the feed and verify
                      the dealership mapping.
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  Primary order-1 images only. Media is revalidated before
                  sending.
                  <Button secondary onClick={() => setSelected([])}>
                    Clear selection
                  </Button>
                </div>
              </div>
            </>
          )}
          {page === "Client upload" && (
            <>
              <Heading
                eyebrow="BUILD YOUR AUDIENCE"
                title="Client upload"
                description="Map spreadsheet columns, validate numbers and review recipients."
              />
              <CustomerUpload result={audience} onChange={setAudience} />
            </>
          )}
          {page === "Dealership settings" && (
            <>
              <Heading
                eyebrow="CONNECT YOUR WORKSPACE"
                title="Dealership settings"
                description="Manage and manually verify DealerOS and PostX configuration."
              />
              {config ? (
                <DealershipSettings
                  key={JSON.stringify(config)}
                  config={config}
                  vehicles={data.vehicles}
                  onSave={save}
                />
              ) : (
                <div className="panel empty-state">
                  Apply the dealership seed migration to configure your
                  workspace.
                </div>
              )}
            </>
          )}
          {page === "Campaign preview" && (
            <>
              <Heading
                eyebrow="GIVE IT A FINAL LOOK"
                title="Campaign preview"
                description="Review your WhatsApp carousel and confirm before contacting customers."
              >
                <Button secondary onClick={() => navigate("Vehicle stock")}>
                  Edit selection
                </Button>
              </Heading>
              <CampaignPreview
                config={config}
                vehicles={chosen}
                recipients={audience?.recipients || []}
                sending={data.sending}
                onQueued={async (id) => {
                  setAudience(null);
                  setSelected([]);
                  navigate("Campaign history");
                  setNotice(
                    `Campaign ${id} queued. You may close the browser; the scheduled worker processes batches.`,
                  );
                  try {
                    await load();
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              />
            </>
          )}
          {page === "Campaign history" && (
            <>
              <Heading
                eyebrow="YOUR CAMPAIGN WORKSPACE"
                title="Campaign history"
                description="Submission outcomes, not delivery or engagement metrics. Updates every 15 seconds."
              />
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "CAMPAIGN",
                        "DEALERSHIP",
                        "CREATED",
                        "VEHICLES",
                        "RECIPIENTS",
                        "STATUS",
                        "ACCEPTED",
                        "FAILED",
                        "UNKNOWN",
                        "DETAILS",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>{c.config_snapshot.name}</td>
                        <td>{date(c.created_at)}</td>
                        <td>{c.vehicle_count}</td>
                        <td>{c.recipient_count}</td>
                        <td>
                          <span className="badge">{c.status}</span>
                        </td>
                        <td>{c.accepted_count}</td>
                        <td>{c.failed_count}</td>
                        <td>{c.unknown_count}</td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => inspect(c.id)}
                          >
                            Inspect
                          </button>
                          {["queued", "processing"].includes(c.status) && (
                            <button
                              className="text-button"
                              onClick={() => cancel(c.id)}
                            >
                              Cancel pending
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.campaigns.length && (
                  <p className="empty-state">No campaign submissions yet.</p>
                )}
              </div>
              {details && (
                <section className="panel settings-panel">
                  <h2>Campaign details</h2>
                  <p>
                    {details.snapshot.vehicles
                      .map((v) => `${v.make} ${v.model} (${v.year})`)
                      .join(" · ")}
                  </p>
                  {details.batches.map((b) => (
                    <details key={b.id}>
                      <summary>
                        Batch {b.position + 1} · {b.status} ·{" "}
                        {b.recipient_count} recipients
                      </summary>
                      <p>
                        Started {date(b.started_at)} · Finished{" "}
                        {date(b.finished_at)}
                      </p>
                      {b.error && <p className="form-error">{b.error}</p>}
                      {!b.recipient_results.length && (
                        <p>
                          Correlation references:{" "}
                          {b.recipient_references.join(", ")}
                        </p>
                      )}
                      <ul>
                        {b.recipient_results.map((r) => (
                          <li key={r.external_reference}>
                            {r.external_reference}: {r.status}
                            {r.conversation_id
                              ? ` · conversation ${r.conversation_id}`
                              : ""}
                            {r.error ? ` · ${r.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  <p>
                    Unknown outcomes require reconciliation in PostX using
                    external references. There is no automatic retry.
                  </p>
                </section>
              )}
            </>
          )}
          <div className="safe-note">
            <ShieldCheck size={17} /> Only contact customers with the
            appropriate consent. Queued recipients are private and cleared after
            processing.
          </div>
          <footer className="page-footer">
            <span>© 2026 Super Group · Media Card Tool</span>
            <span>Built for better connections.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense
      fallback={<main className="auth-loading">Loading workspace…</main>}
    >
      <AuthGate Brand={Brand}>
        {(session, signOut) => (
          <Dashboard
            key={session.user.id}
            session={session}
            signOut={signOut}
          />
        )}
      </AuthGate>
    </Suspense>
  </React.StrictMode>,
);
