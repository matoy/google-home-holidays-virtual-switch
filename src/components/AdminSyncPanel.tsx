"use client";

import { useState } from "react";

interface DateCheckResult {
  date: string;
  isOn: boolean;
  reasonLabel: string;
}

interface AdminSyncPanelProps {
  initialDate: string;
  homeGraphConfigured: boolean;
  homeGraphError?: string | null;
}

export function AdminSyncPanel({
  initialDate,
  homeGraphConfigured,
  homeGraphError,
}: AdminSyncPanelProps) {
  const [testDate, setTestDate] = useState(initialDate);
  const [dateResult, setDateResult] = useState<DateCheckResult | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [checkingDate, setCheckingDate] = useState(false);

  const [password, setPassword] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  async function handleAdminAction(action: "report_state" | "request_sync") {
    setSyncing(true);
    setSyncMessage(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error || `HTTP ${res.status}`);
      } else if (action === "request_sync") {
        setSyncMessage("HomeGraph Request Sync succeeded.");
      } else {
        setSyncMessage(
          `Reported state (${data.isOn ? "ON" : "OFF"} for ${data.date}) to HomeGraph (requestId: ${data.requestId}).`,
        );
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSyncing(false);
    }
  }

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
        <h2>Google HomeGraph Control</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Push current state immediately after linking or test HomeGraph credentials.
        </p>

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

        <div className="field">
          <label htmlFor="admin-pwd">Admin Password</label>
          <input
            id="admin-pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="ADMIN_PASSWORD"
          />
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn-primary"
            disabled={syncing || !password || !homeGraphConfigured}
            onClick={() => handleAdminAction("report_state")}
          >
            Report State Now
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={syncing || !password || !homeGraphConfigured}
            onClick={() => handleAdminAction("request_sync")}
          >
            Request Sync
          </button>
        </div>

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
