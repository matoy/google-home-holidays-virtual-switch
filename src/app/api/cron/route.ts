import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import { isHomeGraphConfigured, reportSwitchStateToHomeGraph } from "@/lib/homegraph";
import { constantTimeEquals } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleCron(request: NextRequest) {
  const config = getAppConfig();
  if (!config.cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${config.cronSecret}`;
  if (!constantTimeEquals(authHeader, expectedHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceParam = request.nextUrl.searchParams.get("force");
  const force = forceParam === "1" || forceParam === "true";

  const snapshot = await getHolidayScheduleSnapshot({ forceRefresh: true });
  const changed = snapshot.current.isOn !== snapshot.yesterday.isOn;
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
        return NextResponse.json(
          {
            ok: false,
            parisNow: snapshot.parisNow,
            isOn: snapshot.current.isOn,
            yesterdayIsOn: snapshot.yesterday.isOn,
            changed,
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
