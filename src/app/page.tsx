import { cookies } from "next/headers";
import { AdminSyncPanel } from "@/components/AdminSyncPanel";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/admin-auth";
import { getAppConfig } from "@/lib/config";
import { addDaysYmd, compareYmd, formatHumanDate } from "@/lib/date";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import { getHomeGraphConfigStatus } from "@/lib/homegraph";
import { getSwitchOverride, isSharedOverrideStoreConfigured } from "@/lib/override";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const config = getAppConfig();
  const homeGraphStatus = getHomeGraphConfigStatus();
  const homeGraphConfigured = homeGraphStatus.configured;
  const cookieStore = await cookies();
  const isAdminAuthenticated = verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );
  const sharedStoreConfigured = isSharedOverrideStoreConfigured();

  let snapshot: Awaited<ReturnType<typeof getHolidayScheduleSnapshot>> | null = null;
  let loadError: string | null = null;

  try {
    snapshot = await getHolidayScheduleSnapshot();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load Zone-C calendar";
  }

  const activeOverride = snapshot ? await getSwitchOverride() : null;
  const effectiveIsOn = snapshot ? (activeOverride ? activeOverride.isOn : snapshot.current.isOn) : false;

  const upcomingPeriods = snapshot
    ? snapshot.periods.filter((p) => compareYmd(p.endDate, snapshot.parisNow.date) > 0)
    : [];

  return (
    <main className="container">
      <header className="header-row">
        <div>
          <h1>{config.deviceName}</h1>
          <div className="muted">
            Google Home Cloud-to-cloud virtual switch · France Zone C · <code>Europe/Paris</code>
          </div>
        </div>
        <span
          className={`pill pill-sm ${homeGraphConfigured ? "pill-on" : "pill-warn"}`}
        >
          HomeGraph:{" "}
          {homeGraphConfigured
            ? "Configured"
            : homeGraphStatus.error
              ? "Invalid config"
              : "Not configured"}
        </span>
      </header>

      {loadError || !snapshot ? (
        <section className="card">
          <div className="alert alert-error" style={{ marginBottom: 0 }}>
            Could not load Zone-C ICS feed: {loadError}
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="status-hero">
              <div>
                <div className="muted" style={{ marginBottom: "0.35rem" }}>
                  Current switch state ({formatHumanDate(snapshot.parisNow.date)} ·{" "}
                  {snapshot.parisNow.time} Paris)
                </div>
                <div style={{ fontSize: "1.15rem", fontWeight: 600 }}>
                  {activeOverride
                    ? `Manual test override active (Calendar: ${snapshot.current.isOn ? "ON" : "OFF"} — ${snapshot.current.reasonLabel})`
                    : snapshot.current.reasonLabel}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                {activeOverride && (
                  <span className="pill pill-sm pill-warn">Test Override</span>
                )}
                <span className={`pill ${effectiveIsOn ? "pill-on" : "pill-off"}`}>
                  Switch is {effectiveIsOn ? "ON" : "OFF"}
                </span>
              </div>
            </div>

            <div className="meta-list" style={{ marginTop: "1.1rem" }}>
              <div className="meta-row">
                <span className="muted">Next state change</span>
                <span>
                  {snapshot.nextTransition ? (
                    <>
                      Turns <strong>{snapshot.nextTransition.nextState ? "ON" : "OFF"}</strong> on{" "}
                      {formatHumanDate(snapshot.nextTransition.date)} ({snapshot.nextTransition.date})
                    </>
                  ) : (
                    "No transition within the next 420 days"
                  )}
                </span>
              </div>
              <div className="meta-row">
                <span className="muted">Yesterday ({snapshot.yesterday.date})</span>
                <span>{snapshot.yesterday.isOn ? "ON" : "OFF"}</span>
              </div>
              <div className="meta-row">
                <span className="muted">ICS source</span>
                <span>
                  {snapshot.source === "live" ? "Live feed" : "Stale cache fallback"} ·{" "}
                  <code>{snapshot.calendarUrl}</code>
                </span>
              </div>
            </div>
          </section>

          <AdminSyncPanel
            initialDate={snapshot.parisNow.date}
            homeGraphConfigured={homeGraphConfigured}
            homeGraphError={homeGraphStatus.error}
            initialAuthenticated={isAdminAuthenticated}
            initialOverride={activeOverride}
            calendarIsOn={snapshot.current.isOn}
            sharedStoreConfigured={sharedStoreConfigured}
          />

          <section className="card">
            <h2>Upcoming &amp; Active Zone C Holiday Periods ({upcomingPeriods.length})</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Switch turns <strong>ON</strong> at <code>00:00 Europe/Paris</code> during each
              period, except the 1st Saturday and 1st Sunday inside the period (<strong>OFF</strong>
              ).
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>ICS Dates (Inclusive)</th>
                    <th>1st Sat / Sun (OFF)</th>
                    <th>Switch Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPeriods.map((period) => {
                    const isCurrent = snapshot.current.activePeriod?.id === period.id;
                    const lastInclusiveDay = addDaysYmd(period.endDate, -1);
                    const weekendExcluded = [period.firstSaturday, period.firstSunday]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <tr key={period.id} className={isCurrent ? "row-active" : undefined}>
                        <td>
                          <strong>{period.title}</strong>
                        </td>
                        <td>
                          {formatHumanDate(period.startDate)} → {formatHumanDate(lastInclusiveDay)}
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {period.startDate} to {lastInclusiveDay} (school resumes {period.endDate})
                          </div>
                        </td>
                        <td>{weekendExcluded || "None"}</td>
                        <td>
                          {isCurrent ? (
                            <span
                              className={`pill pill-sm ${
                                snapshot.current.isOn ? "pill-on" : "pill-off"
                              }`}
                            >
                              Active now ({snapshot.current.isOn ? "ON" : "OFF"})
                            </span>
                          ) : (
                            <span className="muted">Upcoming</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Integration Endpoints</h2>
            <div className="meta-list">
              <div className="meta-row">
                <span className="muted">Authorization URL</span>
                <code>/oauth/authorize</code>
              </div>
              <div className="meta-row">
                <span className="muted">Token URL</span>
                <code>/api/oauth/token</code>
              </div>
              <div className="meta-row">
                <span className="muted">Smart Home Fulfillment URL</span>
                <code>/api/smarthome</code>
              </div>
              <div className="meta-row">
                <span className="muted">Daily Schedule (02:00 Europe/Paris)</span>
                <code>/api/cron</code>
              </div>
              <div className="meta-row">
                <span className="muted">Ignored ICS events (non-holidays)</span>
                <span>{snapshot.ignoredEvents.length} events (e.g. Rentrée scolaire)</span>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
