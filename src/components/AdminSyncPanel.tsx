"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SwitchOverride } from "@/lib/override";

interface DateCheckResult {
  date: string;
  isOn: boolean;
  reasonLabel: string;
}

interface AdminSyncPanelProps {
  initialDate: string;
  homeGraphConfigured: boolean;
  homeGraphError?: string | null;
  initialAuthenticated: boolean;
  initialOverride: SwitchOverride | null;
  calendarIsOn: boolean;
  sharedStoreConfigured: boolean;
}

export function AdminSyncPanel({
  initialDate,
  homeGraphConfigured,
  homeGraphError,
  initialAuthenticated,
  initialOverride,
  calendarIsOn,
  sharedStoreConfigured,
}: AdminSyncPanelProps) {
  const router = useRouter();

  const [testDate, setTestDate] = useState(initialDate);
  const [dateResult, setDateResult] = useState<DateCheckResult | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [checkingDate, setCheckingDate] = useState(false);

  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [override, setOverride] = useState<SwitchOverride | null>(initialOverride);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function handleCheckDate(e: React.FormEvent) {
    e.preventDefault();
    setCheckingDate(true);
    setDateError(null);
    try {
      const res = await fetch(`/api/status?date=${encodeURIComponent(testDate)}`);
      const data = await res.json();
      if (!res.ok) {
        setDateError(data.error || `HTTP ${res.status}`);
        setDateResult(null);
      } else {
        setDateResult({
          date: data.current.date,
          isOn: data.current.isOn,
          reasonLabel: data.current.reasonLabel,
        });
      }
    } catch (err) {
      setDateError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setCheckingDate(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error || `HTTP ${res.status}`);
      } else {
        setAuthenticated(true);
        setPassword("");
        router.refresh();
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Login request failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    setBusyAction("logout");
    setSyncError(null);
    setSyncMessage(null);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      setAuthenticated(false);
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSwitchMode(mode: "on" | "off" | "auto") {
    setBusyAction(`switch:${mode}`);
    setSyncMessage(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/admin/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setAuthenticated(false);
        setSyncError("Session expired. Please log in again.");
        return;
      }

      if (data.override !== undefined) {
        setOverride(data.override);
      }

      if (!res.ok) {
        setSyncError(data.error || `HTTP ${res.status}`);
      } else {
        const stateText = data.isOn ? "ON" : "OFF";
        const hgNote = data.homeGraphReported
          ? `pushed to Google HomeGraph (requestId: ${data.requestId})`
          : "local state updated (HomeGraph not configured)";
        setSyncMessage(
          mode === "auto"
            ? `Reset to Zone C calendar (${stateText}) — ${hgNote}.`
            : `Test override set to ${stateText} — ${hgNote}.`,
        );
      }
      router.refresh();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAdminAction(action: "report_state" | "request_sync") {
    setBusyAction(action);
    setSyncMessage(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setAuthenticated(false);
        setSyncError("Session expired. Please log in again.");
        return;
      }
      if (!res.ok) {
        setSyncError(data.error || `HTTP ${res.status}`);
      } else if (action === "request_sync") {
        setSyncMessage("HomeGraph Request Sync succeeded.");
      } else {
        setSyncMessage(
          `Reported state (${data.isOn ? "ON" : "OFF"} for ${data.date}${data.overridden ? ", override" : ""}) to HomeGraph (requestId: ${data.requestId}).`,
        );
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyAction(null);
    }
  }

  const currentModeLabel = override
    ? `Test Override: Forced ${override.isOn ? "ON" : "OFF"}`
    : `Auto (Calendar: ${calendarIsOn ? "ON" : "OFF"})`;

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Date Simulator</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Preview the switch state for any date in <code>Europe/Paris</code>.
        </p>
        <form onSubmit={handleCheckDate}>
          <div className="field">
            <label htmlFor="sim-date">Date</label>
            <input
              id="sim-date"
              type="date"
              value={testDate}
              onChange={(e) => setTestDate(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-secondary" disabled={checkingDate}>
            {checkingDate ? "Checking..." : "Check Date"}
          </button>
        </form>

        {dateError && (
          <div className="alert alert-error" style={{ marginTop: "0.85rem", marginBottom: 0 }}>
            {dateError}
          </div>
        )}
        {dateResult && (
          <div
            className={`alert ${dateResult.isOn ? "alert-success" : ""}`}
            style={{
              marginTop: "0.85rem",
              marginBottom: 0,
              borderColor: dateResult.isOn ? undefined : "var(--border)",
              background: dateResult.isOn ? undefined : "var(--surface-muted)",
            }}
          >
            <strong>{dateResult.date}:</strong> Switch is{" "}
            <strong>{dateResult.isOn ? "ON" : "OFF"}</strong> — {dateResult.reasonLabel}
          </div>
        )}
      </section>

      <section className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0 }}>Admin &amp; Google Home Control</h2>
          {authenticated && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }}
              disabled={busyAction !== null}
              onClick={handleLogout}
            >
              Sign out
            </button>
          )}
        </div>

        {!homeGraphConfigured && (
          <div className="alert alert-error">
            {homeGraphError ? (
              homeGraphError
            ) : (
              <>
                Service Account env var missing (<code>GOOGLE_SERVICE_ACCOUNT_JSON</code>).
              </>
            )}
          </div>
        )}

        {!authenticated ? (
          <form onSubmit={handleLogin}>
            <p className="muted" style={{ marginTop: 0 }}>
              Log in with <code>ADMIN_PASSWORD</code> to toggle the virtual switch for Google Home
              testing or trigger HomeGraph sync.
            </p>
            <div className="field">
              <label htmlFor="admin-pwd">Admin Password</label>
              <input
                id="admin-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter ADMIN_PASSWORD"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={authLoading || !password}>
              {authLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <div>
            <div className="muted" style={{ marginBottom: "0.65rem" }}>
              Mode: <strong>{currentModeLabel}</strong>
            </div>

            <div className="btn-row" style={{ marginBottom: "0.85rem" }}>
              <button
                type="button"
                className={override?.isOn === true ? "btn-primary" : "btn-secondary"}
                disabled={busyAction !== null}
                onClick={() => handleSwitchMode("on")}
              >
                {busyAction === "switch:on" ? "Applying..." : "Force ON"}
              </button>
              <button
                type="button"
                className={override?.isOn === false ? "btn-primary" : "btn-secondary"}
                disabled={busyAction !== null}
                onClick={() => handleSwitchMode("off")}
              >
                {busyAction === "switch:off" ? "Applying..." : "Force OFF"}
              </button>
              <button
                type="button"
                className={override === null ? "btn-primary" : "btn-secondary"}
                disabled={busyAction !== null}
                onClick={() => handleSwitchMode("auto")}
              >
                {busyAction === "switch:auto" ? "Resetting..." : "Reset to Calendar (Auto)"}
              </button>
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={busyAction !== null || !homeGraphConfigured}
                onClick={() => handleAdminAction("report_state")}
              >
                {busyAction === "report_state" ? "Reporting..." : "Report State Now"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busyAction !== null || !homeGraphConfigured}
                onClick={() => handleAdminAction("request_sync")}
              >
                {busyAction === "request_sync" ? "Syncing..." : "Request Sync"}
              </button>
            </div>

            {!sharedStoreConfigured && (
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem", marginBottom: 0 }}>
                Test overrides push immediately via HomeGraph Report State (and reset automatically
                on daily cron or after 12h). For cross-instance Vercel <code>QUERY</code>{" "}
                persistence, configure <code>UPSTASH_REDIS_REST_URL</code> /{" "}
                <code>KV_REST_API_URL</code>.
              </p>
            )}
          </div>
        )}

        {syncError && (
          <div className="alert alert-error" style={{ marginTop: "0.85rem", marginBottom: 0 }}>
            {syncError}
          </div>
        )}
        {syncMessage && (
          <div className="alert alert-success" style={{ marginTop: "0.85rem", marginBottom: 0 }}>
            {syncMessage}
          </div>
        )}
      </section>
    </div>
  );
}
