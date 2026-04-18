import { NextResponse } from "next/server";
import { z } from "zod";
import { createHeavyProject } from "@/lib/heavy-worker";
import { createMovieProject, saveSourceAssets } from "@/lib/pipeline";
import { isVercelRuntime } from "@/lib/runtime-storage";
import { addProject } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  creatorName: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  genre: z.string().min(1),
  premise: z.string().min(10),
  scenePrompt: z.string().min(10),
  persona: z.string().min(2),
  renderMode: z
    .enum(["fast-trailer", "prompt-movie-beta", "heavy-worker-beta"])
    .default("prompt-movie-beta"),
});

function titleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : "Untitled Pulse";
}

function autoFillFromPrompt(prompt: string, templateId: string) {
  const normalized = prompt.trim();
  const title = titleFromPrompt(normalized);
  const creatorNameMatch = normalized.match(/\b(?:i am|i'm|my name is|starring)\s+([a-z0-9_-]+)/i);
  const creatorName = creatorNameMatch?.[1]
    ? creatorNameMatch[1].replace(/\b\w/g, (char) => char.toUpperCase())
    : "Creator";
  const lower = normalized.toLowerCase();
  const genre =
    /(love|romance|girlfriend|boyfriend|kiss)/.test(lower)
      ? "Romance"
      : /(fight|kung fu|battle|war|gang)/.test(lower)
        ? "Action"
        : /(adventure|journey|quest|travel)/.test(lower)
          ? "Adventure"
          : /(sad|tears|breakup|pain)/.test(lower)
            ? "Drama"
            : "Cinematic";
  const persona =
    /(fight|kung fu|battle)/.test(lower)
      ? "fearless fighter"
      : /(love|romance)/.test(lower)
        ? "romantic lead"
        : /(adventure|quest)/.test(lower)
          ? "restless adventurer"
          : "cinematic main character";
  const premise = normalized;
  const scenePrompt = `Turn this into a short movie scene: ${normalized}. Use the ${templateId} template mood with vertical framing and cinematic pacing.`;

  return { creatorName, title, genre, persona, premise, scenePrompt };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video = formData.get("video");
    const selfie = formData.get("selfie");
    const quickPrompt = String(formData.get("quickPrompt") ?? "").trim();
    const templateIdValue = String(formData.get("templateId") ?? "");

    if (!(video instanceof File) || video.size === 0) {
      return NextResponse.json({ error: "A video clip is required." }, { status: 400 });
    }

    const rawValues = quickPrompt
      ? {
          ...autoFillFromPrompt(quickPrompt, templateIdValue),
          templateId: templateIdValue,
          renderMode: formData.get("renderMode"),
        }
      : {
      creatorName: formData.get("creatorName"),
      title: formData.get("title"),
      templateId: formData.get("templateId"),
      genre: formData.get("genre"),
      premise: formData.get("premise"),
      scenePrompt: formData.get("scenePrompt"),
      persona: formData.get("persona"),
      renderMode: formData.get("renderMode"),
        };

    const parsed = schema.safeParse(rawValues);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "The form data is incomplete." },
        { status: 400 },
      );
    }

    if (isVercelRuntime() && !process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()) {
      return NextResponse.json(
        {
          error:
            "The public Vercel app needs PULSEREEL_REMOTE_MODEL_BACKEND_URL before it can render movies. Local generation works on your PC, but Vercel cannot run the full local FFmpeg/Python/ComfyUI pipeline inside a web request.",
        },
        { status: 503 },
      );
    }

    if (parsed.data.renderMode === "heavy-worker-beta") {
      const { sourceVideoUrl, sourceImageUrl } = await saveSourceAssets(
        video,
        selfie instanceof File && selfie.size > 0 ? selfie : undefined,
      );

      const project = await createHeavyProject({
        creatorName: parsed.data.creatorName,
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        genre: parsed.data.genre,
        premise: parsed.data.premise,
        scenePrompt: parsed.data.scenePrompt,
        persona: parsed.data.persona,
        renderMode: "heavy-worker-beta",
        sourceVideoUrl,
        sourceImageUrl,
      });

      return NextResponse.json({ slug: project.slug, status: project.status });
    }

    const project = await createMovieProject({
      ...parsed.data,
      videoFile: video,
      imageFile: selfie instanceof File && selfie.size > 0 ? selfie : undefined,
    });

    await addProject(project);

    return NextResponse.json({ slug: project.slug, status: project.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The movie pipeline failed." },
      { status: 500 },
    );
  }
}
