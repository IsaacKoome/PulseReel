import { NextResponse } from "next/server";
import {
  applyReplicatePrediction,
  type ReplicatePrediction,
  verifyReplicateWebhook,
} from "@/lib/replicate-direct";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    if (!(await verifyReplicateWebhook(request.headers, rawBody))) {
      return NextResponse.json({ error: "Invalid Replicate webhook signature." }, { status: 401 });
    }

    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) {
      return NextResponse.json({ error: "Missing PulseReel project ID." }, { status: 400 });
    }

    const prediction = JSON.parse(rawBody) as ReplicatePrediction;
    if (!prediction.id || !prediction.status) {
      return NextResponse.json({ error: "Invalid Replicate prediction payload." }, { status: 400 });
    }

    const project = await applyReplicatePrediction(projectId, prediction);
    if (!project) {
      return NextResponse.json({ error: "PulseReel project not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, status: project.status });
  } catch (error) {
    console.error("PulseReel Replicate webhook failed.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Replicate webhook processing failed." },
      { status: 500 },
    );
  }
}
