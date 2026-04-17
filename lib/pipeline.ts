import { promises as fs } from "fs";
import crypto from "crypto";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";
import { v4 as uuid } from "uuid";
import { getTemplateById } from "@/data/templates";
import type { MovieProject, ShotSpec, StoryBeat } from "@/lib/types";
import { slugify } from "@/lib/utils";

const VIDEO_SIZE = { width: 720, height: 1280 };
const BACKGROUND_REMOVAL_PATH = `file://${path.resolve("node_modules/@imgly/background-removal-node/dist/")}/`;
const TARGET_MOVIE_SECONDS = 60;
const TARGET_SHOT_SECONDS = 5;
const USE_EXPERIMENTAL_MOTION = process.platform !== "win32";
const CACHE_DIR = path.join(process.cwd(), "public", "generated", "cache");

function resolveFfmpegPath() {
  const candidates = [
    ffmpegPath as string | null,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const normalized = path.normalize(candidate);
      require("fs").accessSync(normalized);
      return normalized;
    } catch {
      continue;
    }
  }

  throw new Error("FFmpeg binary was not found locally. Reinstall dependencies and try again.");
}

ffmpeg.setFfmpegPath(resolveFfmpegPath());

type ProjectInput = {
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";
  videoFile: File;
  imageFile?: File | null;
};

type ScenePlan = {
  setting: string;
  action: string;
  enemyCount: number;
  accentWords: string[];
  palette: [string, string, string];
};

function escapeXml(value: string) {
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
  templateId,
}: Omit<ProjectInput, "videoFile" | "imageFile" | "title" | "genre">): StoryBeat[] {
  const template = getTemplateById(templateId);

  return [
    {
      heading: "Hook",
      text: `${creatorName} enters as ${persona || "the main character"}, where ${template.beats[0].toLowerCase()} Premise: ${premise}`,
    },
    {
      heading: "Turn",
      text: `${template.beats[1]} We anchor the emotion with: ${scenePrompt}`,
    },
    {
      heading: "Final Image",
      text: `${template.beats[2]} The ending should leave the audience with a repeat-watch feeling.`,
    },
  ];
}

function buildScenePrompts(project: {
  creatorName: string;
  title: string;
  scenePrompt: string;
  premise: string;
  persona: string;
  templateId: string;
}) {
  const template = getTemplateById(project.templateId);
  return [
    `${template.openingShot} The creator is framed as ${project.persona || "a fearless lead"} in "${project.title}".`,
    `Mid-scene energy: ${project.scenePrompt}. Build around the idea "${project.premise}" with vertical composition and tactile lighting.`,
    `Closing tableau for ${project.creatorName}: ${template.posterMood} The image should feel ready for a teaser poster.`,
  ];
}

function inferScenePlan(input: {
  templateId: string;
  premise: string;
  scenePrompt: string;
  persona: string;
}): ScenePlan {
  const text = `${input.premise} ${input.scenePrompt} ${input.persona}`.toLowerCase();
  const template = getTemplateById(input.templateId);
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
      : "Mythic hero reveal";
  const setting = hasForest
    ? hasNight
      ? "Moonlit forest battleground"
      : "Forest battleground"
    : hasWater
      ? "Storm-swept riverfront"
      : "Cinematic legend zone";
  const palette: [string, string, string] = hasForest
    ? hasNight
      ? ["#052e2b", "#0f766e", "#051923"]
      : ["#14532d", "#365314", "#0f172a"]
    : hasFire
      ? ["#7c2d12", "#ea580c", "#1f2937"]
      : template.palette;

  return {
    setting,
    action,
    enemyCount,
    accentWords: [
      hasForest ? "Forest" : "Epic",
      action,
      hasNight ? "Night" : "Daybreak",
      enemyCount > 0 ? `${enemyCount} enemies` : "Solo legend",
    ],
    palette,
  };
}

async function ensurePublicFolders() {
  await fs.mkdir(path.join(process.cwd(), "public", "uploads"), { recursive: true });
  await fs.mkdir(path.join(process.cwd(), "public", "generated"), { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function saveFile(file: File, folder: "uploads" | "generated") {
  const ext = path.extname(file.name || "clip.webm") || ".webm";
  const filename = `${uuid()}${ext}`;
  const outputPath = path.join(process.cwd(), "public", folder, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return `/${folder}/${filename}`;
}

export async function saveSourceAssets(videoFile: File, imageFile?: File | null) {
  await ensurePublicFolders();
  const sourceVideoUrl = await saveFile(videoFile, "uploads");
  const sourceImageUrl = imageFile ? await saveFile(imageFile, "uploads") : undefined;
  return { sourceVideoUrl, sourceImageUrl };
}

function cacheKey(...parts: string[]) {
  return crypto.createHash("sha1").update(parts.join("::")).digest("hex");
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function renderPoster(project: {
  title: string;
  creatorName: string;
  templateId: string;
  premise: string;
}) {
  const template = getTemplateById(project.templateId);
  const filename = `${uuid()}.svg`;
  const outputPath = path.join(process.cwd(), "public", "generated", filename);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${template.palette[0]}"/>
      <stop offset="45%" stop-color="${template.palette[1]}"/>
      <stop offset="100%" stop-color="${template.palette[2]}"/>
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
    template.tagline,
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
  return `/generated/${filename}`;
}

function buildShotPlan(input: {
  title: string;
  creatorName: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  templateId: string;
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";
}) {
  const plan = inferScenePlan(input);
  const template = getTemplateById(input.templateId);
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
      prompt: `${template.posterMood} The world settles into memory, but its life still moves around ${input.creatorName}.`,
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
      prompt: `${template.posterMood} The scene should feel like the beginning of a larger love story.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow fade into warmth.",
      composition: "Poster-like romantic portrait with atmospheric depth.",
    },
    ...adventureShots.slice(5, 12),
  ];

  const conflictShots: Omit<ShotSpec, "id" | "label">[] = [
    {
      title: "Opening reveal",
      prompt: `${plan.setting}. ${template.openingShot} ${input.creatorName} appears as ${input.persona}.`,
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
      title: "Legend in motion",
      prompt: `${plan.setting}. ${input.creatorName} now feels larger than the original environment.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Mythic movement with purposeful camera drift.",
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
      prompt: `${template.posterMood} ${input.creatorName} stands over the conflict as a legend.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Slow rise into triumphant stillness.",
      composition: "Poster-like centered frame with powerful silhouette separation.",
    },
    {
      title: "Afterglow",
      prompt: `${plan.setting}. The energy settles, but the legend remains in the air.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Breathing room with emotional release.",
      composition: "Atmospheric hold with clean hero readability.",
    },
    {
      title: "Final lock",
      prompt: `${plan.setting}. The world now sees ${input.creatorName} as ${input.persona}.`,
      durationSeconds: TARGET_SHOT_SECONDS,
      motionHint: "Final mythic hold with subtle scale drift.",
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

async function extractFrameFromVideo(sourcePath: string) {
  const outputPath = path.join(CACHE_DIR, `${cacheKey("frame", sourcePath)}.png`);

  if (await fileExists(outputPath)) {
    return outputPath;
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(sourcePath)
      .seekInput(0.8)
      .frames(1)
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return outputPath;
}

async function createPortraitCutout(sourceImagePath: string) {
  const outputPath = path.join(CACHE_DIR, `${cacheKey("cutout", sourceImagePath)}.png`);

  if (await fileExists(outputPath)) {
    return outputPath;
  }

  try {
    const blob = await removeBackground(sourceImagePath, {
      publicPath: BACKGROUND_REMOVAL_PATH,
      model: "small",
      output: { format: "image/png", quality: 0.9 },
    });
    const buffer = Buffer.from(await blob.arrayBuffer());
    await sharp(buffer)
      .resize({
        height: 860,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(outputPath);
  } catch {
    await sharp(sourceImagePath)
      .resize(620, 860, { fit: "cover", position: "attention" })
      .composite([
        {
          input: Buffer.from(
            `<svg width="620" height="860"><rect width="620" height="860" rx="280" fill="white"/></svg>`,
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toFile(outputPath);
  }

  return outputPath;
}

function buildSceneSvg(options: {
  title: string;
  creatorName: string;
  caption: string;
  plan: ScenePlan;
  stage: "intro" | "battle" | "finale";
}) {
  const [a, b, c] = options.plan.palette;
  const title = escapeXml(options.title.toUpperCase());
  const creator = escapeXml(options.creatorName.toUpperCase());
  const caption = escapeXml(options.caption);
  const bandLabel =
    options.stage === "intro"
      ? "ORIGIN MODE"
      : options.stage === "battle"
        ? "ACTION PHASE"
        : "FINAL STRIKE";
  const subtitle =
    options.stage === "intro"
      ? `${options.plan.setting} | ${options.plan.action}`
      : options.stage === "battle"
        ? `${options.plan.enemyCount || 1} enemy silhouettes break the frame`
        : "Legend status locked";
  const circles =
    options.stage === "battle"
      ? `<circle cx="560" cy="380" r="240" fill="rgba(255,255,255,0.05)"/><circle cx="130" cy="250" r="120" fill="rgba(249,115,22,0.15)"/>`
      : `<circle cx="560" cy="260" r="220" fill="rgba(255,255,255,0.06)"/><circle cx="160" cy="1070" r="220" fill="rgba(255,255,255,0.05)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_SIZE.width}" height="${VIDEO_SIZE.height}" viewBox="0 0 ${VIDEO_SIZE.width} ${VIDEO_SIZE.height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${a}"/>
        <stop offset="58%" stop-color="${b}"/>
        <stop offset="100%" stop-color="${c}"/>
      </linearGradient>
    </defs>
    <rect width="${VIDEO_SIZE.width}" height="${VIDEO_SIZE.height}" fill="url(#bg)"/>
    ${circles}
    <path d="M0 1030 C 120 900, 240 1080, 360 920 S 620 1060, 720 910 V 1280 H 0 Z" fill="rgba(4,15,22,0.75)"/>
    <path d="M0 920 C 120 830, 240 970, 360 860 S 620 940, 720 850 V 1280 H 0 Z" fill="rgba(7,26,18,0.52)"/>
    <rect x="36" y="36" width="648" height="1208" rx="32" fill="rgba(4,12,22,0.22)" stroke="rgba(255,255,255,0.08)"/>
    <text x="60" y="90" fill="#f4efe6" font-size="22" font-family="Trebuchet MS, Segoe UI, sans-serif" letter-spacing="4">${bandLabel}</text>
    <text x="60" y="760" fill="#f4efe6" font-size="72" font-family="Georgia, Times New Roman, serif" font-weight="700">${title}</text>
    <text x="60" y="810" fill="#f4efe6" opacity="0.88" font-size="28" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeXml(
      subtitle,
    )}</text>
    <text x="60" y="1116" fill="#f4efe6" font-size="22" font-family="Trebuchet MS, Segoe UI, sans-serif" letter-spacing="3">STARRING ${creator}</text>
    <foreignObject x="60" y="1140" width="520" height="96">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color:#f4efe6;font-family:'Trebuchet MS','Segoe UI',sans-serif;font-size:24px;line-height:1.35;opacity:.9;">${caption}</div>
    </foreignObject>
  </svg>`;
}

function buildEnemySilhouette(index: number, total: number): sharp.OverlayOptions {
  const x = 60 + index * ((VIDEO_SIZE.width - 160) / Math.max(total, 1));
  const y = 780 + (index % 2) * 28;

  return {
    input: Buffer.from(
      `<svg width="150" height="420" viewBox="0 0 150 420" xmlns="http://www.w3.org/2000/svg">
        <g fill="rgba(10,18,24,0.7)">
          <ellipse cx="76" cy="74" rx="38" ry="44"/>
          <path d="M48 118 C 36 178, 38 246, 52 332 L 98 332 C 114 246, 114 174, 102 118 Z"/>
          <path d="M44 332 L 24 412 L 48 412 L 70 332 Z"/>
          <path d="M104 332 L 82 412 L 106 412 L 126 332 Z"/>
          <path d="M36 162 L 0 250 L 22 258 L 62 188 Z"/>
          <path d="M114 162 L 86 190 L 128 254 L 148 244 Z"/>
        </g>
      </svg>`,
    ),
    left: x,
    top: y,
    blend: "over",
    density: 96,
  };
}

async function renderSceneImage(options: {
  title: string;
  creatorName: string;
  caption: string;
  stage: "intro" | "battle" | "finale";
  plan: ScenePlan;
  characterPath: string;
  shot?: ShotSpec;
}) {
  const cachePath = path.join(
    CACHE_DIR,
    `${cacheKey(
      "scene-image",
      options.title,
      options.creatorName,
      options.caption,
      options.stage,
      options.characterPath,
      options.shot?.label ?? "none",
      options.plan.setting,
      options.plan.action,
      String(options.plan.enemyCount),
    )}.png`,
  );

  if (await fileExists(cachePath)) {
    return cachePath;
  }

  const background = Buffer.from(
    buildSceneSvg({
      title: options.title,
      creatorName: options.creatorName,
      caption: options.caption,
      plan: options.plan,
      stage: options.stage,
    }),
  );

  const character = await sharp(options.characterPath)
    .resize({
      width: options.stage === "battle" ? 370 : 430,
      height: options.stage === "battle" ? 760 : 860,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const characterShadow = await sharp(character)
    .tint({ r: 10, g: 14, b: 20 })
    .blur(2)
    .ensureAlpha(0.5)
    .png()
    .toBuffer();
  const characterShadowSoft = await sharp(character)
    .tint({ r: 10, g: 14, b: 20 })
    .blur(2)
    .ensureAlpha(0.38)
    .png()
    .toBuffer();
  const motionEcho = await sharp(character)
    .modulate({ brightness: 0.55, saturation: 1.3 })
    .tint("#f97316")
    .ensureAlpha(0.23)
    .png()
    .toBuffer();

  const composites: sharp.OverlayOptions[] = [];

  if (options.stage === "battle" && options.plan.enemyCount > 0) {
    for (let index = 0; index < options.plan.enemyCount; index += 1) {
      composites.push(buildEnemySilhouette(index, options.plan.enemyCount));
    }
  }

  if (options.stage === "intro") {
    composites.push({ input: characterShadowSoft, left: 340, top: 286 });
    composites.push({ input: character, left: 300, top: 230 });
  }

  if (options.stage === "battle") {
    composites.push({ input: motionEcho, left: 252, top: 298 });
    composites.push({ input: characterShadow, left: 318, top: 338 });
    composites.push({ input: character, left: 270, top: 278 });
  }

  if (options.stage === "finale") {
    composites.push({ input: characterShadowSoft, left: 220, top: 308 });
    composites.push({ input: character, left: 180, top: 250 });
    composites.push({
      input: Buffer.from(
        `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><text x="60" y="162" fill="#f4efe6" font-size="18" font-family="Trebuchet MS, Segoe UI, sans-serif" letter-spacing="6">${escapeXml(
          (options.shot?.label ? `${options.shot.label} | ` : "") + options.plan.accentWords.join(" | ").toUpperCase(),
        )}</text></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }

  await sharp(background).composite(composites).png().toFile(cachePath);
  return cachePath;
}

async function renderScenePlate(options: {
  title: string;
  creatorName: string;
  caption: string;
  stage: "intro" | "battle" | "finale";
  plan: ScenePlan;
}) {
  const outputPath = path.join(
    CACHE_DIR,
    `${cacheKey("scene-plate", options.title, options.creatorName, options.caption, options.stage, options.plan.setting)}.png`,
  );

  if (await fileExists(outputPath)) {
    return outputPath;
  }

  const background = Buffer.from(
    buildSceneSvg({
      title: options.title,
      creatorName: options.creatorName,
      caption: options.caption,
      plan: options.plan,
      stage: options.stage,
    }),
  );

  await sharp(background).png().toFile(outputPath);
  return outputPath;
}

async function createEnemyLayer(enemyCount: number) {
  const outputPath = path.join(CACHE_DIR, `${cacheKey("enemies", String(enemyCount))}.png`);

  if (await fileExists(outputPath)) {
    return outputPath;
  }

  const overlays: sharp.OverlayOptions[] = [];
  const count = Math.max(0, Math.min(enemyCount, 8));

  for (let index = 0; index < count; index += 1) {
    overlays.push(buildEnemySilhouette(index, count));
  }

  await sharp({
    create: {
      width: VIDEO_SIZE.width,
      height: VIDEO_SIZE.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(overlays)
    .png()
    .toFile(outputPath);

  return outputPath;
}

function getHeroMotion(stage: "intro" | "battle" | "finale", index: number) {
  if (stage === "intro") {
    return {
      x: `${240 + (index % 2) * 24}+22*sin(t*1.4)+t*6`,
      y: `${250 + (index % 3) * 10}+10*cos(t*1.2)-t*2`,
    };
  }

  if (stage === "battle") {
    return {
      x: `${220 + (index % 2) * 18}+36*sin(t*2.8)+18*cos(t*1.3)`,
      y: `${286 + (index % 3) * 8}+22*cos(t*3.1)`,
    };
  }

  return {
    x: `${190 + (index % 2) * 14}+14*sin(t*0.9)`,
    y: `${250 + (index % 3) * 12}-8*sin(t*1.1)`,
  };
}

function getPlateZoom(durationSeconds: number, stage: "intro" | "battle" | "finale") {
  const zoomRate = stage === "battle" ? 0.0021 : 0.0014;
  const maxZoom = stage === "battle" ? 1.22 : 1.14;
  return `z='min(1.0+${zoomRate}*on,${maxZoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(
    durationSeconds * 25,
  )}:s=${VIDEO_SIZE.width}x${VIDEO_SIZE.height}`;
}

async function renderAnimatedShotVideo(options: {
  title: string;
  creatorName: string;
  caption: string;
  stage: "intro" | "battle" | "finale";
  plan: ScenePlan;
  characterPath: string;
  shot: ShotSpec;
  shotIndex: number;
}) {
  const platePath = await renderScenePlate({
    title: options.title,
    creatorName: options.creatorName,
    caption: options.caption,
    stage: options.stage,
    plan: options.plan,
  });
  const enemyLayerPath =
    options.stage === "battle" && options.plan.enemyCount > 0
      ? await createEnemyLayer(options.plan.enemyCount)
      : null;
  const outputPath = path.join(process.cwd(), "public", "generated", `${uuid()}-${options.shot.label}.mp4`);
  const heroMotion = getHeroMotion(options.stage, options.shotIndex);
  const heroWidth = options.stage === "battle" ? 360 : 420;
  const heroHeight = options.stage === "battle" ? 760 : 860;
  const filters: string[] = [
    `[0:v]scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height},zoompan=${getPlateZoom(
      options.shot.durationSeconds,
      options.stage,
    )},fps=25,setsar=1[plate]`,
    `[1:v]scale=${heroWidth}:${heroHeight}:force_original_aspect_ratio=decrease[hero]`,
  ];

  let currentLabel = "plate";
  let inputIndex = 2;

  if (enemyLayerPath) {
    filters.push(`[2:v]scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}[enemy]`);
    filters.push(
      `[plate][enemy]overlay=x='10*sin(t*1.8)':y='6*cos(t*1.5)':shortest=1[plate_with_enemy]`,
    );
    currentLabel = "plate_with_enemy";
    inputIndex = 3;
  }

  filters.push(
    `[${currentLabel}][hero]overlay=x='${heroMotion.x}':y='${heroMotion.y}':shortest=1,trim=duration=${options.shot.durationSeconds.toFixed(
      2,
    )},setpts=PTS-STARTPTS,format=yuv420p[v]`,
  );

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg();
    command.input(platePath).inputOptions(["-loop 1"]);
    command.input(options.characterPath).inputOptions(["-loop 1"]);
    if (enemyLayerPath) {
      command.input(enemyLayerPath).inputOptions(["-loop 1"]);
    }

    command
      .complexFilter(filters, "v")
      .outputOptions([
        "-map",
        "[v]",
        "-r",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-t",
        options.shot.durationSeconds.toFixed(2),
        "-shortest",
        "-an",
        "-movflags",
        "+faststart",
      ])
      .videoCodec("libx264")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return outputPath;
}

async function renderShotSegment(options: {
  title: string;
  creatorName: string;
  caption: string;
  stage: "intro" | "battle" | "finale";
  plan: ScenePlan;
  characterPath: string;
  shot: ShotSpec;
  shotIndex: number;
}) {
  if (!USE_EXPERIMENTAL_MOTION) {
    const fallbackImage = await renderSceneImage({
      title: options.title,
      creatorName: options.creatorName,
      caption: options.caption,
      stage: options.stage,
      plan: options.plan,
      characterPath: options.characterPath,
      shot: options.shot,
    });
    return imageToVideo(fallbackImage, options.shot.durationSeconds, `${options.shot.label}-fallback`);
  }

  try {
    return await renderAnimatedShotVideo(options);
  } catch {
    const fallbackImage = await renderSceneImage({
      title: options.title,
      creatorName: options.creatorName,
      caption: options.caption,
      stage: options.stage,
      plan: options.plan,
      characterPath: options.characterPath,
      shot: options.shot,
    });
    return imageToVideo(fallbackImage, options.shot.durationSeconds, `${options.shot.label}-fallback`);
  }
}

async function imageToVideo(imagePath: string, durationSeconds: number, label: string) {
  const outputPath = path.join(process.cwd(), "public", "generated", `${uuid()}-${label}.mp4`);
  const frameCount = Math.max(1, Math.round(durationSeconds * 25));

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        "-vf",
        `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height},zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${VIDEO_SIZE.width}x${VIDEO_SIZE.height},fps=25,trim=duration=${durationSeconds.toFixed(2)},fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(
          0,
          durationSeconds - 0.45,
        ).toFixed(2)}:d=0.45,setpts=PTS-STARTPTS,format=yuv420p`,
        "-t",
        durationSeconds.toFixed(2),
        "-shortest",
        "-r",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-an",
      ])
      .videoCodec("libx264")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return outputPath;
}

async function stylizeSourceClip(sourcePath: string, label: string, durationSeconds: number, variant: number) {
  const outputPath = path.join(process.cwd(), "public", "generated", `${uuid()}-${label}.mp4`);
  const startTime = (variant * 1.1) % 4;
  const filterVariants = [
    `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.18:saturation=1.2:brightness=-0.02,unsharp=5:5:0.8:3:3:0.2,drawbox=x=28:y=28:w=iw-56:h=ih-56:color=white@0.12:t=2,trim=duration=${durationSeconds.toFixed(2)},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(
      0,
      durationSeconds - 0.35,
    ).toFixed(2)}:d=0.35,setpts=PTS-STARTPTS`,
    `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:(ow-iw)/2:(oh-ih)/2:black,hflip,eq=contrast=1.12:saturation=1.35:brightness=-0.04,trim=duration=${durationSeconds.toFixed(2)},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(
      0,
      durationSeconds - 0.35,
    ).toFixed(2)}:d=0.35,setpts=PTS-STARTPTS`,
    `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.24:saturation=1.1:gamma=1.06,boxblur=1:1,trim=duration=${durationSeconds.toFixed(2)},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(
      0,
      durationSeconds - 0.35,
    ).toFixed(2)}:d=0.35,setpts=PTS-STARTPTS`,
    `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.15:saturation=1.28:brightness=-0.03,colorchannelmixer=rr=1.02:gg=0.98:bb=1.04,trim=duration=${durationSeconds.toFixed(2)},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(
      0,
      durationSeconds - 0.35,
    ).toFixed(2)}:d=0.35,setpts=PTS-STARTPTS`,
  ];
  const selectedFilter = filterVariants[variant % filterVariants.length];

  await new Promise<void>((resolve, reject) => {
    ffmpeg(sourcePath)
      .seekInput(startTime)
      .outputOptions([
        "-vf",
        `${selectedFilter},fps=25,format=yuv420p`,
        "-t",
        durationSeconds.toFixed(2),
        "-an",
        "-r",
        "25",
        "-pix_fmt",
        "yuv420p",
      ])
      .videoCodec("libx264")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return outputPath;
}

function stageForShot(index: number, total: number): "intro" | "battle" | "finale" {
  if (index === 0) return "intro";
  if (index === total - 1) return "finale";
  return "battle";
}

function shouldInsertSourceMotion(
  shot: ShotSpec,
  index: number,
  total: number,
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta",
) {
  if (index >= total - 1) {
    return false;
  }

  if (renderMode === "fast-trailer") {
    return index === 1 || index === total - 2;
  }

  return (
    shot.worldActivity === "high" ||
    shot.shotKind === "interaction" ||
    shot.shotKind === "observer" ||
    shot.subjectFraming === "world-first" ||
    index % 4 === 2
  );
}

function sourceMotionDurationForShot(shot: ShotSpec) {
  const insertDuration =
    shot.shotKind === "interaction"
      ? 2.2
      : shot.shotKind === "observer" || shot.worldActivity === "high"
        ? 1.8
        : shot.motionHint.toLowerCase().includes("explosive")
          ? 1.6
          : 1.25;

  return Math.min(Math.max(1, insertDuration), Math.max(1, shot.durationSeconds - 1.4));
}

async function concatVideoSegments(segmentPaths: string[]) {
  const listPath = path.join(process.cwd(), "public", "generated", `${uuid()}-concat.txt`);
  const outputFilename = `${uuid()}.mp4`;
  const outputPath = path.join(process.cwd(), "public", "generated", outputFilename);
  const fileContents = segmentPaths.map((segmentPath) => `file '${segmentPath.replaceAll("\\", "/")}'`).join("\n");
  await fs.writeFile(listPath, fileContents, "utf8");

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions([
        "-fflags",
        "+genpts",
        "-vsync",
        "cfr",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "25",
        "-t",
        `${TARGET_MOVIE_SECONDS}`,
        "-movflags",
        "+faststart",
        "-an",
      ])
      .videoCodec("libx264")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return `/generated/${outputFilename}`;
}

async function createAmbientAudioTrack() {
  const outputPath = path.join(CACHE_DIR, `ambient-${TARGET_MOVIE_SECONDS}s.wav`);
  if (await fileExists(outputPath)) {
    return outputPath;
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(
        `anoisesrc=d=${TARGET_MOVIE_SECONDS}:c=pink:r=44100:a=0.035,highpass=f=120,lowpass=f=900,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(
          0,
          TARGET_MOVIE_SECONDS - 4,
        )}:d=4`,
      )
      .inputFormat("lavfi")
      .outputOptions([
        "-t",
        `${TARGET_MOVIE_SECONDS}`,
        "-c:a",
        "pcm_s16le",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .run();
  });

  return outputPath;
}

async function attachAudioAndSubtleEffects(videoRelativeUrl: string) {
  const sourcePath = path.join(process.cwd(), "public", videoRelativeUrl.replace(/^\//, ""));
  const outputFilename = `${uuid()}-scored.mp4`;
  const outputPath = path.join(process.cwd(), "public", "generated", outputFilename);

  try {
    const audioPath = await createAmbientAudioTrack();
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(sourcePath)
        .input(audioPath)
        .outputOptions([
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          "-movflags",
          "+faststart",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (error: Error) => reject(error))
        .run();
    });
  } catch {
    await fs.copyFile(sourcePath, outputPath);
  }

  return `/generated/${outputFilename}`;
}

async function processVideo(input: {
  sourceVideoUrl: string;
  sourceImageUrl?: string;
  title: string;
  creatorName: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  templateId: string;
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";
}) {
  const sourcePath = path.join(process.cwd(), "public", input.sourceVideoUrl.replace(/^\//, ""));
  const heroSourcePath = input.sourceImageUrl
    ? path.join(process.cwd(), "public", input.sourceImageUrl.replace(/^\//, ""))
    : await extractFrameFromVideo(sourcePath);
  const characterPath = await createPortraitCutout(heroSourcePath);
  const plan = inferScenePlan(input);
  const shotPlan = buildShotPlan(input);

  const generatedShotSegments = await Promise.all(
    shotPlan.map((shot, index) => {
      const motionDuration = shouldInsertSourceMotion(shot, index, shotPlan.length, input.renderMode)
        ? sourceMotionDurationForShot(shot)
        : 0;
      const stillShot = {
        ...shot,
        durationSeconds: Math.max(1, shot.durationSeconds - motionDuration),
      };

      return renderShotSegment({
        title: input.title,
        creatorName: input.creatorName,
        caption: stillShot.prompt,
        stage: stageForShot(index, shotPlan.length),
        plan,
        characterPath,
        shot: stillShot,
        shotIndex: index,
      });
    }),
  );

  const motionIndexes = generatedShotSegments
    .map((_, index) => {
      const shouldInsertMotion = shouldInsertSourceMotion(shotPlan[index], index, shotPlan.length, input.renderMode);
      return shouldInsertMotion ? index : -1;
    })
    .filter((index) => index >= 0);

  const motionClipEntries = await Promise.all(
    motionIndexes.map(async (index) => ({
      index,
      clip: await stylizeSourceClip(
        sourcePath,
        `${plan.action}-${index + 1}`,
        sourceMotionDurationForShot(shotPlan[index]),
        index,
      ),
    })),
  );
  const motionMap = new Map(motionClipEntries.map((entry) => [entry.index, entry.clip]));

  const segmentSequence: string[] = [];
  for (let index = 0; index < generatedShotSegments.length; index += 1) {
    segmentSequence.push(generatedShotSegments[index]);
    const motionClip = motionMap.get(index);
    if (motionClip) {
      segmentSequence.push(motionClip);
    }
  }

  return {
    processedVideoUrl: await attachAudioAndSubtleEffects(await concatVideoSegments(segmentSequence)),
    shotPlan,
  };
}

export async function createMovieProject(input: ProjectInput): Promise<MovieProject> {
  await ensurePublicFolders();

  const title = input.title.trim() || "Untitled Pulse";
  const creatorName = input.creatorName.trim() || "Anonymous Creator";
  const sourceVideoUrl = await saveFile(input.videoFile, "uploads");
  const sourceImageUrl = input.imageFile ? await saveFile(input.imageFile, "uploads") : undefined;
  const baseProject = await createMovieProjectDraft({
    ...input,
    title,
    creatorName,
    sourceVideoUrl,
    sourceImageUrl,
    status: "published",
  });
    const { processedVideoUrl, shotPlan } = await processVideo({
      sourceVideoUrl,
      sourceImageUrl,
      title,
      creatorName,
      genre: input.genre,
      premise: input.premise,
      scenePrompt: input.scenePrompt,
      persona: input.persona,
      templateId: input.templateId,
      renderMode: input.renderMode,
  });
  const posterUrl = await renderPoster({
    title,
    creatorName,
    templateId: input.templateId,
    premise: input.premise,
  });
  return {
    ...baseProject,
    status: "published",
    updatedAt: new Date().toISOString(),
    shotPlan,
    scenePrompts: buildScenePrompts({
      creatorName,
      title,
      premise: input.premise.trim(),
      scenePrompt: input.scenePrompt.trim(),
      persona: input.persona.trim(),
      templateId: baseProject.templateId,
    }),
    posterUrl,
    processedVideoUrl,
    workerJob: undefined,
  };
}

export async function createMovieProjectDraft(
  input: Omit<ProjectInput, "videoFile" | "imageFile"> & {
    sourceVideoUrl: string;
    sourceImageUrl?: string;
    status?: "draft" | "processing" | "published";
  },
): Promise<MovieProject> {
  await ensurePublicFolders();
  const template = getTemplateById(input.templateId);
  const createdAt = new Date().toISOString();
  const title = input.title.trim() || "Untitled Pulse";
  const creatorName = input.creatorName.trim() || "Anonymous Creator";
  const slugBase = slugify(`${title}-${creatorName}`) || uuid().slice(0, 8);

  return {
    id: uuid(),
    slug: `${slugBase}-${uuid().slice(0, 6)}`,
    creatorName,
    title,
    templateId: template.id,
    genre: input.genre.trim() || template.genres[0],
    premise: input.premise.trim(),
    scenePrompt: input.scenePrompt.trim(),
    persona: input.persona.trim(),
    renderMode: input.renderMode,
    status: input.status ?? "processing",
    createdAt,
    updatedAt: createdAt,
    hook: template.hook,
    openingShot: template.openingShot,
    caption: `${title} by ${creatorName}. ${template.hook}`,
    beats: buildBeats(input),
    shotPlan: buildShotPlan(input),
    scenePrompts: buildScenePrompts({
      creatorName,
      title,
      premise: input.premise.trim(),
      scenePrompt: input.scenePrompt.trim(),
      persona: input.persona.trim(),
      templateId: template.id,
    }),
    posterUrl: await renderPoster({
      title,
      creatorName,
      templateId: template.id,
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

export async function renderMovieForProject(project: MovieProject) {
  const { processedVideoUrl, shotPlan } = await processVideo({
    sourceVideoUrl: project.sourceVideoUrl,
    sourceImageUrl: project.sourceImageUrl,
    title: project.title,
    creatorName: project.creatorName,
    genre: project.genre,
    premise: project.premise,
    scenePrompt: project.scenePrompt,
    persona: project.persona,
    templateId: project.templateId,
    renderMode: project.renderMode,
  });

  return {
    processedVideoUrl,
    shotPlan,
  };
}
