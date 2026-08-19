import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, BellOff, ChevronRight, RefreshCw, Search, X, Download } from "lucide-react";
import clsx from "clsx";
import { fetchAlerts, ThermalApiError } from "../lib/api";
import { CAUSES, causeLabel } from "../lib/labels";
import type { LiveAlert } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type RiskLevel = "safe" | "warn" | "danger";

const RISK_TONES: Record<RiskLevel, string> = {
  safe: "text-teal-600 dark:text-teal-300",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

function StatCard({ label, value, risk, filter, active, onHover, onClick }: { label: string; value: string; risk: RiskLevel; filter?: boolean; active?: boolean; onHover?: (hover: boolean) => void; onClick?: () => void }) {
  const tone = RISK_TONES[risk];
  return (
    <div
      role={filter || onHover ? "button" : undefined}
      tabIndex={filter || onHover ? 0 : undefined}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onFocus={onHover ? () => onHover(true) : undefined}
      onBlur={onHover ? () => onHover(false) : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e: ReactKeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={clsx(
        "flex flex-col items-center justify-center gap-1 rounded-2xl border bg-white p-5 text-center shadow-sm transition dark:bg-ink-900",
        active ? "border-primary-500 ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-ink-900" : "border-ink-100 dark:border-ink-800",
        (onClick || onHover) && "cursor-pointer hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default function Alerts() {
  const { buildingId = "esi-algiers" } = useParams();
  const [alerts, setAlerts] = useState<LiveAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [cause, setCause] = useState<string>("all");
  const [confidence, setConfidence] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "energy">("newest");
  const [datePreset, setDatePreset] = useState<"24h" | "7d" | "30d" | "custom">("7d");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [hoverFilter, setHoverFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAlerts(buildingId, controller.signal)
      .then(setAlerts)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load alerts");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  useEffect(() => {
    const id = setInterval(() => setReloadKey((k) => k + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const totalCount = alerts?.length ?? 0;
  const highEnergyCount = useMemo(() => (alerts ?? []).filter((a) => (a.energyWastedKwh ?? 0) > 50).length, [alerts]);
  const pendingCount = useMemo(() => (alerts ?? []).filter((a) => a.causeConfidence === "undetermined" || a.causeConfidence === "low").length, [alerts]);
  const totalEnergyWasted = useMemo(() => (alerts ?? []).reduce((sum, a) => sum + (a.energyWastedKwh || 0), 0), [alerts]);

  const filtered = useMemo(() => {
    const now = Date.now();
    let fromTs: number | null = null;
    let toTs: number | null = null;
    if (datePreset !== "custom") {
      if (datePreset === "24h") fromTs = now - 24 * 60 * 60 * 1000;
      else if (datePreset === "7d") fromTs = now - 7 * 24 * 60 * 60 * 1000;
      else if (datePreset === "30d") fromTs = now - 30 * 24 * 60 * 60 * 1000;
      toTs = now;
    } else {
      fromTs = from ? +new Date(`${from}T00:00:00`) : null;
      toTs = to ? +new Date(`${to}T23:59:59`) : null;
    }

    const q = search.trim().toLowerCase();
    const list = (alerts ?? []).filter((a) => {
      const ts = +new Date(a.sentAt);
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (cause !== "all" && a.cause !== cause) return false;
      if (confidence !== "all" && a.causeConfidence !== confidence) return false;
      if (q && !`${a.roomLabel} ${a.cause} ${a.message} ${a.recipient} ${a.channel}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.sentAt) - +new Date(a.sentAt);
      if (sort === "oldest") return +new Date(a.sentAt) - +new Date(b.sentAt);
      return (b.energyWastedKwh ?? 0) - (a.energyWastedKwh ?? 0);
    });
  }, [alerts, search, cause, confidence, sort, datePreset, from, to]);

  const PAGE_SIZE = 5;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const causeOptions = useMemo(() => {
    const set = new Set<string>();
    (alerts ?? []).forEach((a) => set.add(a.cause));
    return [...set].sort();
  }, [alerts]);

  const confidenceOptions = useMemo(() => {
    const set = new Set<string>();
    (alerts ?? []).forEach((a) => set.add(a.causeConfidence));
    return [...set].sort();
  }, [alerts]);

  const clearFilters = () => {
    setSearch("");
    setCause("all");
    setConfidence("all");
    setSort("newest");
    setDatePreset("7d");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const exportCSV = () => {
    const headers = ["Room", "Sent", "Channel", "Recipient", "Cause", "Confidence", "Energy (kWh)", "Message"];
    const rows = filtered.map((a) => [
      a.roomLabel,
      new Date(a.sentAt).toLocaleString(),
      a.channel,
      a.recipient,
      a.cause,
      a.causeConfidence,
      (a.energyWastedKwh ?? 0).toFixed(1),
      a.message,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `alerts-${buildingId}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const matchesHover = (a: LiveAlert): boolean => {
    switch (hoverFilter) {
      case "high":
        return (a.energyWastedKwh ?? 0) > 50;
      case "pending":
        return a.causeConfidence === "undetermined" || a.causeConfidence === "low";
      default:
        return false;
    }
  };

  const resetCardFilters = () => {
    setConfidence("all");
    setCause("all");
    setSearch("");
    setPage(1);
  };

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";
  const dateInputCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Alerts</h1>
          <p className="mt-1 text-[13px] text-ink-400">Dispatched whenever Agent 4's deterministic decision gate routes a diagnosis to a human — live, not mocked.</p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
        </Card>
      )}

      {!error && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Total Alerts"
              value={loading ? "—" : String(totalCount)}
              risk={totalCount === 0 ? "safe" : totalCount <= 2 ? "warn" : "danger"}
              filter
              active={confidence === "all" && cause === "all" && !search}
              onHover={(h) => setHoverFilter(h ? "all" : null)}
              onClick={() => resetCardFilters()}
            />
            <StatCard
              label="Pending Review"
              value={loading ? "—" : String(pendingCount)}
              risk={pendingCount === 0 ? "safe" : "warn"}
              filter active={confidence === "undetermined" || confidence === "low"}
              onHover={(h) => setHoverFilter(h ? "pending" : null)}
              onClick={() => { setConfidence(confidence === "undetermined" || confidence === "low" ? "all" : "undetermined"); setPage(1); }}
            />
            <StatCard
              label="High Energy Impact"
              value={loading ? "—" : String(highEnergyCount)}
              risk={highEnergyCount === 0 ? "safe" : "danger"}
              filter active={sort === "energy"}
              onHover={(h) => setHoverFilter(h ? "high" : null)}
              onClick={() => { setSort(sort === "energy" ? "newest" : "energy"); setPage(1); }}
            />
            <StatCard
              label="Energy Wasted (est.)"
              value={loading ? "—" : `${totalEnergyWasted.toFixed(1)} kWh`}
              risk={totalEnergyWasted <= 0 ? "safe" : totalEnergyWasted <= 50 ? "warn" : "danger"}
              filter active={sort === "energy"}
              onHover={(h) => setHoverFilter(h ? "high" : null)}
              onClick={() => { setSort(sort === "energy" ? "newest" : "energy"); setPage(1); }}
            />
          </div>

          <Card className="mt-6">
            <CardHeader title="All alerts" subtitle="Every diagnosis the deterministic gate decided needed a human to look at." />
            <div className="border-b border-ink-100 px-5 pt-2 dark:border-ink-800">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  type="search"
                  placeholder="Search room, cause, message, recipient…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-[13px] text-ink-700 outline-none placeholder:text-ink-400 focus:placeholder:text-ink-200 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:placeholder:text-ink-400 dark:focus:placeholder:text-ink-200"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 pb-6 pt-4">
                <select className={selectCls} value={cause} onChange={(e) => { setCause(e.target.value); setPage(1); }}>
                  <option value="all">All causes</option>
                  {CAUSES.filter((c) => causeOptions.includes(c)).map((c) => (
                    <option key={c} value={c}>{causeLabel(c)}</option>
                  ))}
                </select>
                <select className={selectCls} value={confidence} onChange={(e) => { setConfidence(e.target.value); setPage(1); }}>
                  <option value="all">All confidence levels</option>
                  {confidenceOptions.map((c) => (
                    <option key={c} value={c}>{formatKey(c)}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-ink-400">Date</span>
                  <select
                    className={selectCls}
                    value={datePreset}
                    onChange={(e) => { setDatePreset(e.target.value as "24h" | "7d" | "30d" | "custom"); setPage(1); }}
                  >
                    <option value="24h">Last 24h</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {datePreset === "custom" && (
                  <>
                    <input type="date" className={dateInputCls} title="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
                    <input type="date" className={dateInputCls} title="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
                  </>
                )}
                <select className={selectCls} value={sort} onChange={(e) => { setSort(e.target.value as "newest" | "oldest" | "energy"); setPage(1); }}>
                  <option value="newest">Sort: Newest</option>
                  <option value="oldest">Sort: Oldest</option>
                  <option value="energy">Sort: Most energy wasted</option>
                </select>
                <button
                  type="button"
                  onClick={exportCSV}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  <Download size={14} /> Export CSV
                </button>
              </div>
            </div>

            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {loading &&
                Array.from({ length: 2 }).map((_, i) => (
                  <Card key={i} className="animate-pulse p-4">
                    <div className="h-4 w-48 rounded bg-ink-100 dark:bg-ink-800" />
                  </Card>
                ))}

              {!loading && pageItems.length === 0 && (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400">
                    <BellOff size={22} />
                  </span>
                  <p className="mt-4 text-[15px] font-medium">No alerts match your current filters</p>
                  <p className="mt-1 max-w-sm text-[13px] text-ink-400">
                    Try adjusting or clearing your filters.
                  </p>
                  {(search || cause !== "all" || confidence !== "all" || datePreset !== "7d" || from || to) && (
                    <button type="button" onClick={clearFilters} className="mt-4 flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800">
                      <X size={14} /> Clear all filters
                    </button>
                  )}
                </div>
              )}

              {!loading &&
                pageItems.map((a) => (
                  <Link key={a.id} to={`/b/${buildingId}/anomalies/${a.anomalyId}`} className="block">
                    <div className={clsx(
                      "flex items-center justify-between p-4 transition hover:border-primary-300 hover:bg-ink-50 dark:hover:bg-ink-800/50",
                      hoverFilter && matchesHover(a) && "bg-primary-50/60 dark:bg-primary-900/20"
                    )}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-medium">{a.roomLabel}</p>
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.channel}</span>
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.recipient.replace("_", " ")}</span>
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{(a.energyWastedKwh ?? 0).toFixed(1)} kWh</span>
                        </div>
                        <p className="mt-1 truncate text-[13px] text-ink-600 dark:text-ink-300">{a.message}</p>
                        <p className="mt-1 text-[12px] text-ink-400">{new Date(a.sentAt).toLocaleString()} · cause <span className="font-medium text-ink-700 dark:text-ink-200">{causeLabel(a.cause)}</span></p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={a.causeConfidence === "high" ? "high" : a.causeConfidence === "medium" ? "medium" : a.causeConfidence === "low" ? "low" : "watch"} label={a.causeConfidence} />
                        <ChevronRight size={16} className="text-ink-300" />
                      </div>
                    </div>
                  </Link>
                ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-6 py-3 text-[12px] text-ink-400 dark:border-ink-800">
              <span>
                {loading
                  ? "Loading…"
                  : filtered.length === 0
                    ? "0 alerts"
                    : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  ‹ Prev
                </button>
                <span className="tabular-nums">Page {currentPage} of {pageCount}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={currentPage >= pageCount}
                  className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  Next ›
                </button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}