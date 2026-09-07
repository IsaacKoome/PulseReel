import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { getRuntimeAssetDir, runtimeAssetUrl } from "@/lib/runtime-storage";
import type { CameraMode, MovieProject, RenderMode, ShotSpec, StoryBeat } from "@/lib/types";
import { slugify } from "@/lib/utils";
const TARGET_SHOT_SECONDS = 5;
const CACHE_DIR = getRuntimeAssetDir("generated", "cache");

export type ProjectInput = {
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  cameraMode: CameraMode;
  renderMode: RenderMode;
  videoFile: File;
  imageFile?: File | null;
};

export type ScenePlan = {
  setting: string;
  action: string;
  enemyCount: number;
  accentWords: string[];
  palette: [string, string, string];
};

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildBeats({
  creatorName,
  premise,
  scenePrompt,
  persona,
}: Pick<ProjectInput, "creatorName" | "premise" | "scenePrompt" | "persona">): StoryBeat[] {
  return [
    {
      heading: "Hook",
      text: `${creatorName} enters as ${persona || "the main character"} in the requested world. Premise: ${premise}`,
    },
    {
      heading: "Turn",
      text: `The central action develops naturally around the creator. Scene direction: ${scenePrompt}`,
    },
    {
      heading: "Final Image",
      text: `The requested scene reaches a clear cinematic resolution that keeps ${creatorName} visually central.`,
    },
  ];
}

export function buildScenePrompts(project: {
  creatorName: string;
  title: string;
  scenePrompt: string;
  premise: string;
  persona: string;
}) {
  return [
    `Establish the requested setting and action. ${project.creatorName} is framed as ${project.persona || "the main character"} in "${project.title}".`,
    `Mid-scene energy: ${project.scenePrompt}. Build around the idea "${project.premise}" with vertical composition, natural motion, and grounded lighting.`,
    `Close on ${project.creatorName} inside the requested world. Keep the result photographic, coherent, and ready for a movie preview.`,
  ];
}

export function inferScenePlan(input: {
  templateId: string;
  premise: string;
  scenePrompt: string;
  persona: string;
}): ScenePlan {
  const text = `${input.premise} ${input.scenePrompt} ${input.persona}`.toLowerCase();
  const hasForest = /(forest|jungle|savanna|tree|bush)/.test(text);
  const hasNight = /(night|moon|dark|shadow)/.test(text);
  const hasFire = /(fire|burn|flame|explosion)/.test(text);
  const hasWater = /(river|rain|water|storm)/.test(text);
  const enemyMatch = text.match(/(\d+)\s+(gang|enemy|fighter|men|people|attackers)/);
  const enemyCount = enemyMatch ? Math.min(Number(enemyMatch[1]), 8) : /(gang|enemy|fighters|attackers)/.test(text) ? 5 : 0;
  const action = /(kung fu|fight|combat|martial)/.test(text)
    ? "Kung Fu showdown"
    : /(chase|run)/.test(text)
      ? "High-speed chase"
      : "Grounded character reveal";
  const setting = hasForest
    ? hasNight
      ? "Moonlit forest battleground"
      : "Forest battleground"
    : hasWater
      ? "Storm-swept riverfront"
      : "Requested cinematic setting";
  const palette: [string, string, string] = hasForest
    ? hasNight
      ? ["#052e2b", "#0f766e", "#051923"]
      : ["#14532d", "#365314", "#0f172a"]
    : hasFire
      ? ["#7c2d12", "#ea580c", "#1f2937"]
      : ["#24170f", "#0d1522", "#050a12"];

  return {
    setting,
    action,
    enemyCount,
    accentWords: [
      hasForest ? "Forest" : "Epic",
      action,
      hasNight ? "Night" : "Daybreak",
      enemyCount > 0 ? `${enemyCount} enemies` : "Solo lead",
    ],
    palette,
  };
}

export async function ensurePublicFolders() {
  await fs.mkdir(getRuntimeAssetDir("uploads"), { recursive: true });
  await fs.mkdir(getRuntimeAssetDir("generated"), { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function saveFile(file: File, folder: "uploads" | "generated") {
  const ext = path.extname(file.name || "clip.webm") || ".webm";
  const filename = `${uuid()}${ext}`;
  const outputPath = getRuntimeAssetDir(folder, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return runtimeAssetUrl(folder, filename);
}

export async function saveSourceFile(file: File) {
  await ensurePublicFolders();
  return saveFile(file, "uploads");
}

export async function saveSourceAssets(videoFile: File, imageFile?: File | null) {
  await ensurePublicFolders();
  const sourceVideoUrl = await saveFile(videoFile, "uploads");
  const sourceImageUrl = imageFile ? await saveFile(imageFile, "uploads") : undefined;
  return { sourceVideoUrl, sourceImageUrl };
}

export async function renderPoster(project: {
  title: string;
  creatorName: string;
  premise: string;
}) {
  const palette: [string, string, string] = ["#24170f", "#0d1522", "#050a12"];
  const filename = `${uuid()}.svg`;
  const outputPath = getRuntimeAssetDir("generated", filename);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette[0]}"/>
      <stop offset="45%" stop-color="${palette[1]}"/>
      <stop offset="100%" stop-color="${palette[2]}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1350" rx="54" fill="url(#bg)"/>
  <circle cx="830" cy="260" r="260" fill="rgba(255,255,255,0.08)"/>
  <circle cx="220" cy="1140" r="260" fill="rgba(255,255,255,0.06)"/>
  <rect x="72" y="72" width="936" height="1206" rx="42" fill="rgba(3,8,15,0.22)" stroke="rgba(255,255,255,0.14)"/>
  <text x="98" y="170" fill="#f4efe6" font-size="34" font-family="Trebuchet MS, Segoe UI, sans-serif" letter-spacing="8">PULSEREEL ORIGINAL</text>
  <text x="98" y="520" fill="#f4efe6" font-size="120" font-family="Georgia, Times New Roman, serif" font-weight="700">${escapeXml(
    project.title.toUpperCase(),
  )}</text>
  <text x="98" y="604" fill="#f4efe6" opacity="0.86" font-size="42" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeXml(
    "IDENTITY-FIRST AI MOVIE",
  )}</text>
  <text x="98" y="1038" fill="#f4efe6" font-size="28" font-family="Trebuchet MS, Segoe UI, sans-serif" letter-spacing="4">STARRING ${escapeXml(
    project.creatorName.toUpperCase(),
  )}</text>
  <foreignObject x="98" y="1088" width="880" height="130">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#f4efe6;font-family:'Trebuchet MS','Segoe UI',sans-serif;font-size:32px;line-height:1.45;opacity:.88;">${escapeXml(
      project.premise,
    )}</div>
  </foreignObject>
  </svg>`;
  await fs.writeFile(outputPath, svg, "utf8");
  return runtimeAssetUrl("generated", filename);
}

export function buildShotPlan(input: {
  title: string;
  creatorName: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  templateId: string;
  renderMode: RenderMode;
}) {
  const plan = inferScenePlan(input);
  const text = `${input.premise} ${input.scenePrompt} ${input.persona} ${input.genre}`.toLowerCase();
  const isAdventure =
    /(adventure|journey|quest|travel|island|pirate|ocean|sea|harbor|shore|boat|explore)/.test(text);
  const isRomance = /(love|romance|girlfriend|boyfriend|kiss|date|heart)/.test(text);
  const isConflict = /(fight|kung fu|battle|war|gang|enemy|attack|revenge)/.test(text);

  const adventureShots: Omit<ShotSpec, "id" | "label">[] = [
    {
      title: "Arrival",
      prompt: `${plan.setting}. ${input.creatorName} arrives and realizes the place is larger and stranger than expected.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow discovery drift into the environment.",
      composition: "Wide vertical establishing frame with layered island or street depth.",
    },
    {
      title: "World passing by",
      prompt: `${input.premise} Show people moving through the world around ${input.creatorName}, each carrying their own purpose.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Measured lateral movement with environmental life passing by.",
      composition: "Observer-style composition with foreground extras and deep background action.",
    },
    {
      title: "Reaction close-up",
      prompt: `${input.creatorName} takes in the environment, visibly blown away by what is happening around them.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Gentle push-in capturing awe and curiosity.",
      composition: "Tight reaction framing with a living world still visible behind the face.",
    },
    {
      title: "Marketplace rhythm",
      prompt: `${input.scenePrompt} Let supporting figures, vendors, fishermen, pirates, or workers animate the edges of the scene.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Busy but readable ambient world motion.",
      composition: "Mid-wide composition with layered background interactions.",
    },
    {
      title: "Local encounter",
      prompt: `${input.creatorName} shares space with the people of this world, feeling both out of place and drawn deeper in.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Curious camera drift that follows nearby movement.",
      composition: "Shared frame between the creator and supporting figures.",
    },
    {
      title: "Landmark reveal",
      prompt: `${plan.setting}. Reveal the landmark that defines this new world and makes the adventure feel real.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Scale-building rise with horizon energy.",
      composition: "Vertical landmark shot with strong environmental depth.",
    },
    {
      title: "Immersion",
      prompt: `${input.creatorName} is now inside the world rather than just observing it from afar.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Fluid movement with people and world texture crossing frame.",
      composition: "Mid shot with supporting world life moving around the hero.",
    },
    {
      title: "Wonder beat",
      prompt: `${input.scenePrompt} Hold on the feeling that this experience will change ${input.creatorName}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Breathing, emotional pause with subtle environmental drift.",
      composition: "Atmospheric portrait with a lively world behind it.",
    },
    {
      title: "Passing lives",
      prompt: `Show pirates, fishermen, sellers, workers, or travelers continuing their routines around ${input.creatorName}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Ambient passing motion with soft continuity between figures.",
      composition: "World-led composition where the hero is part of a broader place.",
    },
    {
      title: "Identity shift",
      prompt: `${plan.setting}. ${input.creatorName} begins to feel transformed by this new environment.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow rise into emotional clarity.",
      composition: "Centered figure with world motifs repeating around them.",
    },
    {
      title: "Afterglow of discovery",
      prompt: `The requested world settles into memory, but its life still moves around ${input.creatorName}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Soft release with lingering environmental motion.",
      composition: "Poster-grade depth with supporting cast still present.",
    },
    {
      title: "Final wonder",
      prompt: `${plan.setting}. The final image should feel like the start of a larger adventure for ${input.creatorName}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Final cinematic hold with slight horizon drift.",
      composition: "Hero-in-world composition, not hero-alone composition.",
    },
  ];

  const romanceShots: Omit<ShotSpec, "id" | "label">[] = [
    {
      title: "First sight",
      prompt: `${plan.setting}. ${input.creatorName} notices someone that immediately changes the emotional temperature of the scene.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Soft push-in with dreamy stillness.",
      composition: "Observer framing with open romantic space.",
    },
    {
      title: "World softens",
      prompt: `${input.premise} Let the environment feel alive but gentler as emotion enters the frame.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Drifting movement with softer eye-lines and passing extras.",
      composition: "Wide vertical frame with romantic separation and ambient life.",
    },
    {
      title: "Shared moment",
      prompt: `${input.scenePrompt} Hold the feeling of a moment that matters before anyone says too much.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Subtle emotional drift.",
      composition: "Two-person emotional composition or implied connection across the frame.",
    },
    {
      title: "Lingering look",
      prompt: `${input.creatorName} reacts with quiet amazement as the world continues around them.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Breathing, suspended time energy.",
      composition: "Tight reaction shot with soft background life.",
    },
    {
      title: "Emotional afterglow",
      prompt: `The requested scene should feel like the beginning of a larger love story.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow fade into warmth.",
      composition: "Poster-like romantic portrait with atmospheric depth.",
    },
    ...adventureShots.slice(5, 12),
  ];

  const conflictShots: Omit<ShotSpec, "id" | "label">[] = [
    {
      title: "Opening reveal",
      prompt: `${plan.setting}. Establish the requested setting and action. ${input.creatorName} appears as ${input.persona}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow push-in with atmospheric tension.",
      composition: "Low-angle hero framing with dramatic headroom.",
    },
    {
      title: "World setup",
      prompt: `${input.premise} Establish the world and its pressure in a rich vertical frame.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Measured drift with environmental buildup.",
      composition: "Wide vertical world-building shot with layered depth.",
    },
    {
      title: "Threat appears",
      prompt: `${input.scenePrompt} Show the danger building around the hero in a cinematic vertical composition.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Tension building from frame edges.",
      composition: "Wider vertical shot with negative space for incoming danger.",
    },
    {
      title: "Hero focus",
      prompt: `${plan.action}. ${input.creatorName} locks into the role of ${input.persona}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Steady rise in dominance and intent.",
      composition: "Tight mid shot with dramatic separation from the background.",
    },
    {
      title: "Pressure wave",
      prompt: `${input.scenePrompt} The odds close in and the scene feels heavier each second.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Whip-pan style pressure and crowding energy.",
      composition: "Busy vertical action frame with foreground danger.",
    },
    {
      title: "Counter move",
      prompt: `${plan.action}. ${input.creatorName} begins to take control of the entire scene.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Explosive forward motion and impact rhythm.",
      composition: "Off-center motion shot with strong directionality.",
    },
    {
      title: "Momentum shift",
      prompt: `${input.scenePrompt} The battle turns and the world starts fearing the hero.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Rising velocity with visual momentum.",
      composition: "Action-heavy frame with dynamic diagonals.",
    },
    {
      title: "Lead in motion",
      prompt: `${plan.setting}. ${input.creatorName} now feels larger than the original environment.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Purposeful movement with controlled camera drift.",
      composition: "Hero silhouette emphasized against atmospheric space.",
    },
    {
      title: "Enemy collapse",
      prompt: `${input.scenePrompt} The opposition breaks under the hero's presence and technique.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Fast collapse into a controlled aftermath.",
      composition: "Chaotic frame resolving into clarity.",
    },
    {
      title: "Victory rise",
      prompt: `${input.creatorName} stands over the resolved conflict with clear character presence.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow rise into triumphant stillness.",
      composition: "Poster-like centered frame with powerful silhouette separation.",
    },
    {
      title: "Afterglow",
      prompt: `${plan.setting}. The energy settles while the atmosphere remains present.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Breathing room with emotional release.",
      composition: "Atmospheric hold with clean hero readability.",
    },
    {
      title: "Final lock",
      prompt: `${plan.setting}. The world now sees ${input.creatorName} as ${input.persona}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Final cinematic hold with subtle scale drift.",
      composition: "Clean hero composition with poster-grade depth.",
    },
  ];

  const chosenShots = isAdventure ? adventureShots : isRomance ? romanceShots : isConflict ? conflictShots : adventureShots;

  function inferShotKind(shot: Omit<ShotSpec, "id" | "label">) {
    const text = `${shot.title} ${shot.prompt} ${shot.composition}`.toLowerCase();
    if (/(landmark|arrival|world setup)/.test(text)) return "landmark" as const;
    if (/(reaction|lingering look|wonder)/.test(text)) return "reaction" as const;
    if (/(shared|encounter|together|first sight|shared moment|local encounter)/.test(text)) return "interaction" as const;
    if (/(passing lives|world passing by|marketplace|world softens|observer|routine)/.test(text)) return "observer" as const;
    if (/(threat|counter move|battle|victory|collapse|hero focus|momentum)/.test(text)) return "action" as const;
    if (/(afterglow|final|identity shift|immersion)/.test(text)) return "aftermath" as const;
    return "establishing" as const;
  }

  function inferSubjectFraming(shot: Omit<ShotSpec, "id" | "label">, shotKind: ReturnType<typeof inferShotKind>) {
    if (shotKind === "reaction") return "hero" as const;
    if (shotKind === "observer" || shotKind === "landmark") return "world-first" as const;
    if (shotKind === "interaction") return "shared-frame" as const;
    if (/(hero-in-world|world-led|supporting world life|layered island|wide vertical)/i.test(shot.composition)) {
      return "hero-in-world" as const;
    }
    return "hero" as const;
  }

  function inferWorldActivity(shot: Omit<ShotSpec, "id" | "label">, shotKind: ReturnType<typeof inferShotKind>) {
    const text = `${shot.prompt} ${shot.composition} ${shot.motionHint}`.toLowerCase();
    if (shotKind === "observer" || shotKind === "interaction" || /(people moving|ambient world|passing|vendors|fishermen|pirates|workers|background interactions)/.test(text)) {
      return "high" as const;
    }
    if (shotKind === "landmark" || shotKind === "action" || /(living world|supporting cast|world texture)/.test(text)) {
      return "medium" as const;
    }
    return "low" as const;
  }

  return chosenShots.map((shot, index) => {
    const shotKind = inferShotKind(shot);
    return {
      id: uuid(),
      ...shot,
      label: `S${index + 1}`,
      shotKind,
      subjectFraming: inferSubjectFraming(shot, shotKind),
      worldActivity: inferWorldActivity(shot, shotKind),
    };
  });
}

export async function createMovieProjectDraft(
  input: Omit<ProjectInput, "videoFile" | "imageFile"> & {
    sourceVideoUrl: string;
    sourceImageUrl?: string;
    status?: "draft" | "processing" | "published" | "failed";
  },
): Promise<MovieProject> {
  await ensurePublicFolders();
  const createdAt = new Date().toISOString();
  const title = input.title.trim() || "Untitled Pulse";
  const creatorName = input.creatorName.trim() || "Anonymous Creator";
  const slugBase = slugify(`${title}-${creatorName}`) || uuid().slice(0, 8);

  return {
    id: uuid(),
    slug: `${slugBase}-${uuid().slice(0, 6)}`,
    creatorName,
    title,
    templateId: input.templateId,
    genre: input.genre.trim() || "Cinematic",
    premise: input.premise.trim(),
    scenePrompt: input.scenePrompt.trim(),
    persona: input.persona.trim(),
    cameraMode: input.cameraMode,
    renderMode: input.renderMode,
    status: input.status ?? "processing",
    createdAt,
    updatedAt: createdAt,
    hook: `A creator enters the world described by "${input.premise.trim() || title}".`,
    openingShot: input.scenePrompt.trim() || `Establish ${creatorName} as the central character in the requested scene.`,
    caption: `${title} by ${creatorName}. An identity-first AI movie scene.`,
    beats: buildBeats(input),
    shotPlan: buildShotPlan(input),
    scenePrompts: buildScenePrompts({
      creatorName,
      title,
      premise: input.premise.trim(),
      scenePrompt: input.scenePrompt.trim(),
      persona: input.persona.trim(),
    }),
    posterUrl: await renderPoster({
      title,
      creatorName,
      premise: input.premise.trim(),
    }),
    processedVideoUrl: input.sourceVideoUrl,
    sourceVideoUrl: input.sourceVideoUrl,
    sourceImageUrl: input.sourceImageUrl,
    metrics: {
      plays: 120 + Math.floor(Math.random() * 1200),
      likes: 12 + Math.floor(Math.random() * 320),
      shares: 3 + Math.floor(Math.random() * 120),
    },
  };
}
