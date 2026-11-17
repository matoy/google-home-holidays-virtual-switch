import { NextRequest, NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getAppConfig } from "@/lib/config";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";
import { isHomeGraphConfigured, reportSwitchStateToHomeGraph } from "@/lib/homegraph";
import { clearSwitchOverride, setSwitchOverride } from "@/lib/override";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getAppConfig();
  if (!config.adminPassword) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 500 });
  }

  let body: { mode?: string; password?: string };
  try {
    body = (await request.json()) as { mode?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isAdminRequestAuthorized(request, body.password)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = body.mode;
  if (mode !== "on" && mode !== "off" && mode !== "auto") {
    return NextResponse.json(
      { error: 'Invalid mode. Expected "on", "off", or "auto".' },
      { status: 400 },
    );
  }

  const homeGraphReady = isHomeGraphConfigured();

  if (mode === "auto") {
    await clearSwitchOverride();
    const snapshot = await getHolidayScheduleSnapshot({ forceRefresh: true });

    if (!homeGraphReady) {
      return NextResponse.json({
        ok: true,
        mode: "auto",
        isOn: snapshot.current.isOn,
        reasonLabel: snapshot.current.reasonLabel,
        override: null,
        homeGraphReported: false,
      });
    }

    try {
      const { requestId } = await reportSwitchStateToHomeGraph({ isOn: snapshot.current.isOn });
      return NextResponse.json({
        ok: true,
        mode: "auto",
        isOn: snapshot.current.isOn,
        reasonLabel: snapshot.current.reasonLabel,
        override: null,
        homeGraphReported: true,
        requestId,
      });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          mode: "auto",
          isOn: snapshot.current.isOn,
          overrideCleared: true,
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }

  const targetIsOn = mode === "on";
  const override = await setSwitchOverride(targetIsOn);

  if (!homeGraphReady) {
    return NextResponse.json({
      ok: true,
      mode,
      isOn: targetIsOn,
      override,
      homeGraphReported: false,
    });
  }

  try {
    const { requestId } = await reportSwitchStateToHomeGraph({ isOn: targetIsOn });
    return NextResponse.json({
      ok: true,
      mode,
      isOn: targetIsOn,
      override,
      homeGraphReported: true,
      requestId,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        isOn: targetIsOn,
        overrideSaved: true,
        override,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
