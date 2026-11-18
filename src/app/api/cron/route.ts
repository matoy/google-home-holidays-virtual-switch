import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import { isHomeGraphConfigured, reportSwitchStateToHomeGraph } from "@/lib/homegraph";
import { constantTimeEquals } from "@/lib/oauth";
import { clearSwitchOverride } from "@/lib/override";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleCron(request: NextRequest) {
  const config = getAppConfig();
  if (!config.cronSecret) {
    console.error("[schedule] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${config.cronSecret}`;
  if (!constantTimeEquals(authHeader, expectedHeader)) {
    console.warn("[schedule] Rejected unauthorized invocation");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceParam = request.nextUrl.searchParams.get("force");
  const force = forceParam === "1" || forceParam === "true";
  const cronScheduleHeader = request.headers.get("x-vercel-cron-schedule") || "manual";

  let snapshot: Awaited<ReturnType<typeof getHolidayScheduleSnapshot>>;
  let clearedOverride: Awaited<ReturnType<typeof clearSwitchOverride>>;
  try {
    [snapshot, clearedOverride] = await Promise.all([
      getHolidayScheduleSnapshot({ forceRefresh: true }),
      clearSwitchOverride(),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[schedule] Failed to evaluate Zone-C schedule:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const changedFromYesterday = snapshot.current.isOn !== snapshot.yesterday.isOn;
  const changedFromOverride =
    clearedOverride !== null && clearedOverride.isOn !== snapshot.current.isOn;
  const changed = changedFromYesterday || changedFromOverride;
  const homeGraphReady = isHomeGraphConfigured();

  let reported = false;
  let reportRequestId: string | null = null;
  let reportError: string | null = null;

  if (changed || force) {
    if (homeGraphReady) {
      try {
        const res = await reportSwitchStateToHomeGraph({ isOn: snapshot.current.isOn });
        reported = true;
        reportRequestId = res.requestId;
      } catch (err) {
        reportError = err instanceof Error ? err.message : String(err);
        console.error(
          "[schedule] HomeGraph reportStateAndNotification failed:",
          JSON.stringify({
            date: snapshot.current.date,
            isOn: snapshot.current.isOn,
            changed,
            force,
            error: reportError,
          }),
        );
        return NextResponse.json(
          {
            ok: false,
            parisNow: snapshot.parisNow,
            isOn: snapshot.current.isOn,
            yesterdayIsOn: snapshot.yesterday.isOn,
            changed,
            overrideCleared: clearedOverride !== null,
            force,
            reported: false,
            homeGraphConfigured: true,
            error: reportError,
          },
          { status: 502 },
        );
      }
    } else {
      reportError = "HomeGraph Service Account is not configured";
    }
  }

  console.info(
    "[schedule] Executed",
    JSON.stringify({
      trigger: cronScheduleHeader,
      parisNow: snapshot.parisNow,
      isOn: snapshot.current.isOn,
      yesterdayIsOn: snapshot.yesterday.isOn,
      reason: snapshot.current.reason,
      changed,
      overrideCleared: clearedOverride !== null,
      force,
      homeGraphConfigured: homeGraphReady,
      reported,
      reportRequestId,
      warning: reportError,
      nextTransition: snapshot.nextTransition?.date ?? null,
    }),
  );

  return NextResponse.json(
    {
      ok: true,
      parisNow: snapshot.parisNow,
      date: snapshot.current.date,
      isOn: snapshot.current.isOn,
      reason: snapshot.current.reason,
      reasonLabel: snapshot.current.reasonLabel,
      yesterdayIsOn: snapshot.yesterday.isOn,
      changed,
      overrideCleared: clearedOverride !== null,
      force,
      homeGraphConfigured: homeGraphReady,
      reported,
      reportRequestId,
      warning: reportError,
      nextTransition: snapshot.nextTransition,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
