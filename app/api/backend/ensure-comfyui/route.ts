import { NextResponse } from "next/server";
import { getBackendCapabilities } from "@/lib/backend-capabilities";

export const runtime = "nodejs";

export async function POST() {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          started: false,
          reason: "local-auto-start-disabled-in-production",
          capabilities: await getBackendCapabilities(),
        },
        { status: 400 },
      );
    }

    const initial = await getBackendCapabilities();
    const { canAutoStartComfyUi, startComfyUiServer } = await import("@/lib/backend-manager");

    if (initial.comfyUiServerReachable) {
      return NextResponse.json({
        started: false,
        reason: "already-running",
        capabilities: initial,
      });
    }

    if (!canAutoStartComfyUi()) {
      return NextResponse.json(
        {
          started: false,
          reason: "install-incomplete",
          capabilities: initial,
        },
        { status: 400 },
      );
    }

    await startComfyUiServer();

    await new Promise((resolve) => setTimeout(resolve, 3500));
    const refreshed = await getBackendCapabilities();

    return NextResponse.json({
      started: refreshed.comfyUiServerReachable,
      reason: refreshed.comfyUiServerReachable ? "started" : "start-requested",
      capabilities: refreshed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not start local ComfyUI.",
      },
      { status: 500 },
    );
  }
}
