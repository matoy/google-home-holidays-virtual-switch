import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import {
  isHomeGraphConfigured,
  reportSwitchStateToHomeGraph,
  requestSyncToHomeGraph,
} from "@/lib/homegraph";
import { constantTimeEquals } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getAppConfig();
  if (!config.adminPassword) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 500 });
  }

  let body: { password?: string; action?: string };
  try {
    body = (await request.json()) as { password?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!constantTimeEquals(body.password || "", config.adminPassword)) {
    return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
  }

  if (!isHomeGraphConfigured()) {
    return NextResponse.json(
      {
        error:
          "HomeGraph Service Account is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY).",
      },
      { status: 400 },
    );
  }

  const action = body.action || "report_state";

  try {
    if (action === "request_sync") {
      await requestSyncToHomeGraph();
      return NextResponse.json({ ok: true, action: "request_sync" });
    }

    const snapshot = await getHolidayScheduleSnapshot({ forceRefresh: true });
    const { requestId } = await reportSwitchStateToHomeGraph({ isOn: snapshot.current.isOn });
    return NextResponse.json({
      ok: true,
      action: "report_state",
      isOn: snapshot.current.isOn,
      date: snapshot.current.date,
      reasonLabel: snapshot.current.reasonLabel,
      requestId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
