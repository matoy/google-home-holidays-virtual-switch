import { NextRequest, NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getAppConfig } from "@/lib/config";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import {
  isHomeGraphConfigured,
  reportSwitchStateToHomeGraph,
  requestSyncToHomeGraph,
} from "@/lib/homegraph";
import { getSwitchOverride } from "@/lib/override";

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

  if (!isAdminRequestAuthorized(request, body.password)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const [snapshot, override] = await Promise.all([
      getHolidayScheduleSnapshot({ forceRefresh: true }),
      getSwitchOverride(),
    ]);
    const effectiveIsOn = override ? override.isOn : snapshot.current.isOn;
    const { requestId } = await reportSwitchStateToHomeGraph({ isOn: effectiveIsOn });
    return NextResponse.json({
      ok: true,
      action: "report_state",
      isOn: effectiveIsOn,
      overridden: Boolean(override),
      date: snapshot.current.date,
      reasonLabel: override ? "Manual test override" : snapshot.current.reasonLabel,
      requestId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
