import { NextRequest, NextResponse } from "next/server";
import { authenticateFulfillmentBearer } from "@/lib/oauth";
import { handleSmartHomeIntent, type SmartHomeRequest } from "@/lib/smarthome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tokenPayload = authenticateFulfillmentBearer(request.headers.get("authorization"));
  if (!tokenPayload) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: SmartHomeRequest;
  try {
    body = (await request.json()) as SmartHomeRequest;
  } catch {
    return NextResponse.json(
      {
        requestId: "unknown",
        payload: { errorCode: "protocolError" },
      },
      { status: 400 },
    );
  }

  try {
    const responsePayload = await handleSmartHomeIntent(body);
    return NextResponse.json(responsePayload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Smart Home fulfillment error:", error);
    return NextResponse.json(
      {
        requestId: body.requestId || "unknown",
        payload: { errorCode: "transientError" },
      },
      { status: 200 },
    );
  }
}
