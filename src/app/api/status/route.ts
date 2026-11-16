import { NextRequest, NextResponse } from "next/server";
import { isValidYmd } from "@/lib/date";
import { getHolidayScheduleSnapshot } from "@/lib/holidays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (dateParam && !isValidYmd(dateParam)) {
    return NextResponse.json(
      { error: "Invalid date parameter. Expected YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const snapshot = await getHolidayScheduleSnapshot({
      forceRefresh: refresh,
      targetDate: dateParam || undefined,
    });
    return NextResponse.json(snapshot, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Zone-C ICS calendar";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
