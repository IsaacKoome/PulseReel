import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import sharp from "sharp";
import type { HeavyRenderProviderId, MovieProject, ShotSpec } from "@/lib/types";
import { getTemplateById } from "@/data/templates";
import { assetUrlToPath, getRuntimeAssetDir, getRuntimeDataDir, runtimeAssetUrl } from "@/lib/runtime-storage";

const JOBS_DIR = path.join(getRuntimeDataDir(), "heavy-jobs");

export type HeavyJobPayload = {
  protocolVersion: "pulsereel-heavy-job-v1";
  jobId: string;
  projectId: string;
  slug: string;
  provider: HeavyRenderProviderId;
  createdAt: string;
  jobRoot: string;
  outputSpec: {
    width: number;
    height: number;
    fps: number;
    totalDurationSeconds: number;
    aspectRatio: "9:16";
    videoCodec: "h264";
    pixelFormat: "yuv420p";
    audio: "optional";
  };
  modelHints: {
    workflow: "shot-to-video";
    preferredMotionBackend: "open-source-local";
    fallbackBehavior: "use-local-motion-runner";
    qualityPriority: "motion-consistency-over-photorealism";
    bridgeTarget: "node-runner" | "python-runner";
    recommendedBackends: string[];
    backendCommandTemplateEnv: "PULSEREEL_MODEL_BACKEND_COMMAND";
    pythonBridgeScript: string;
    comfyUiUrlEnv: "PULSEREEL_COMFYUI_URL";
    comfyUiWorkflowEnv: "PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE";
  };
  assets: {
    sourceVideoUrl: string;
    sourceImageUrl?: string;
    posterUrl: string;
    sourceVideoPath: string;
    sourceImagePath?: string;
    posterPath: string;
    referencesDir: string;
  };
  story: {
    title: string;
    creatorName: string;
    templateId: string;
    genre: string;
    premise: string;
    scenePrompt: string;
    persona: string;
    caption: string;
    hook: string;
    openingShot: string;
    scenePrompts: string[];
    visualIntent: {
      heroLook: string;
      worldScale: string;
      pacing: string;
      realismTarget: string;
      performanceNote: string;
    };
  };
  styleBible: {
    cinematicTone: string;
    lensLanguage: string;
    lightingLanguage: string;
    editRhythm: string;
    cameraBehavior: string;
    textureGoal: string;
    scoreMood: string;
  };
  characterBible: {
    heroDisplayName: string;
    identityAnchor: string;
    wardrobeAnchor: string;
    physicalFeatures: string[];
    screenPresence: string;
    movementStyle: string;
    performanceEnergy: string;
  };
  worldSpec: {
    setting: string;
    atmosphere: string;
    extras: string[];
    landmark: string;
    crowdMood: string;
    recurringMotifs: string[];
    supportingCast: string[];
  };
  shotReferences: Array<{
    shotId: string;
    index: number;
    title: string;
    prompt: string;
    durationSeconds: number;
    motionHint: string;
    composition: string;
    sourceClipOffsetSeconds: number;
    stage: "intro" | "battle" | "finale";
    continuityGroup: "setup" | "conflict" | "resolution";
    continuityAnchor: string;
    emotionalBeat: string;
    cameraGoal: string;
    backgroundAction: string;
    heroAction: string;
    lensSuggestion: string;
    lightingCue: string;
    editInstruction: string;
    negativePrompt: string;
    previousShotSummary?: string;
    nextShotSummary?: string;
    transitionStyle: "dissolve" | "flash" | "drift";
    cameraMove: "push-in" | "push-out" | "pan-left" | "pan-right" | "float";
    colorGrade: "warm" | "cool" | "teal-orange" | "neutral-night";
    shotKind: "establishing" | "observer" | "reaction" | "interaction" | "landmark" | "action" | "aftermath";
    subjectFraming: "hero" | "hero-in-world" | "world-first" | "shared-frame";
    worldActivity: "low" | "medium" | "high";
    motionEnergy: "gentle" | "steady" | "kinetic";
    recurringElements: string[];
    supportingCast: string[];
    referenceSvgPath: string;
    referencePngPath: string;
    conditioningImages: string[];
  }>;
  shots: ShotSpec[];
};

export type HeavyJobResult = {
  jobId: string;
  provider: HeavyRenderProviderId;
  status: "completed" | "failed";
  completedAt: string;
  processedVideoUrl?: string;
  shotPlan?: ShotSpec[];
  error?: string;
};

async function ensureJobsDir() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

function jobDir(jobId: string) {
  return path.join(JOBS_DIR, jobId);
}

function publicUrlToAbsolutePath(publicUrl?: string) {
  if (!publicUrl) {
    return undefined;
  }

  return assetUrlToPath(publicUrl);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function inferWorldSpec(project: MovieProject) {
  const text = `${project.premise} ${project.scenePrompt} ${project.persona} ${project.genre}`.toLowerCase();

  const setting =
    /(island|beach|ocean|sea|pirate|boat|harbor|shore)/.test(text)
      ? "tropical island harbor"
      : /(forest|jungle|savanna|tree|bush|wild)/.test(text)
        ? "lush forest edge"
        : /(city|street|downtown|town|market|urban)/.test(text)
          ? "busy street district"
          : /(palace|kingdom|castle|throne)/.test(text)
            ? "mythic royal stronghold"
            : "cinematic open world";

  const atmosphere =
    /(adventure|journey|quest|pirate|explore)/.test(text)
      ? "windy adventurous haze"
      : /(love|romance|kiss|girlfriend|boyfriend)/.test(text)
        ? "soft romantic glow"
        : /(fight|battle|gang|war|kung fu)/.test(text)
          ? "charged conflict energy"
          : "moody cinematic atmosphere";

  const extras = [
    ...( /(pirate|island|harbor|sea|ocean)/.test(text)
      ? ["pirates", "fishermen", "market stalls", "boats", "nets"]
      : []),
    ...( /(market|street|city|town)/.test(text)
      ? ["passersby", "vendors", "street lights"]
      : []),
    ...( /(forest|jungle|savanna)/.test(text)
      ? ["trees", "mist", "distant silhouettes"]
      : []),
    ...( /(fight|gang|battle|war)/.test(text)
      ? ["threat silhouettes", "watchers"]
      : []),
  ];

  const landmark =
    /(pirate|island|harbor)/.test(text)
      ? "a dockside lookout and anchored wooden boats"
      : /(forest|jungle)/.test(text)
        ? "towering trees and drifting fog"
        : /(city|street|market)/.test(text)
          ? "dense storefronts and layered signs"
          : "a horizon-defining cinematic landmark";

  const crowdMood =
    /(pirate|gang|battle)/.test(text)
      ? "restless and alert"
      : /(love|romance)/.test(text)
        ? "curious but gentle"
        : "busy and alive";

  const recurringMotifs = [
    ...( /(pirate|island|harbor|sea|ocean)/.test(text)
      ? ["weathered boats", "hanging nets", "salt-air haze"]
      : []),
    ...( /(forest|jungle|savanna)/.test(text)
      ? ["misty treeline", "drifting leaves"]
      : []),
    ...( /(city|street|market)/.test(text)
      ? ["lantern glow", "market movement"]
      : []),
    ...( /(love|romance)/.test(text)
      ? ["soft eye-lines", "gentle background figures"]
      : []),
    ...( /(fight|battle|gang)/.test(text)
      ? ["watchful silhouettes", "tense movement"]
      : []),
  ];

  const supportingCast = [
    ...( /(pirate|island|harbor|sea|ocean)/.test(text)
      ? ["pirates", "fishermen"]
      : []),
    ...( /(market|street|city|town)/.test(text)
      ? ["vendors", "passersby"]
      : []),
    ...( /(love|romance)/.test(text)
      ? ["romantic interest", "quiet onlookers"]
      : []),
    ...( /(fight|battle|gang)/.test(text)
      ? ["rivals", "watchers"]
      : []),
  ];

  return {
    setting,
    atmosphere,
    extras: Array.from(new Set(extras)).slice(0, 6),
    landmark,
    crowdMood,
    recurringMotifs: Array.from(new Set(recurringMotifs)).slice(0, 4),
    supportingCast: Array.from(new Set(supportingCast)).slice(0, 4),
  };
}

function renderExtraShapes(
  worldSpec: ReturnType<typeof inferWorldSpec>,
  shot: ShotSpec,
  index: number,
  supportingCast: string[],
  recurringElements: string[],
  shotKind: HeavyJobPayload["shotReferences"][number]["shotKind"],
  subjectFraming: HeavyJobPayload["shotReferences"][number]["subjectFraming"],
  worldActivity: HeavyJobPayload["shotReferences"][number]["worldActivity"],
) {
  const shapes: string[] = [];
  const extras = Array.from(new Set([...worldSpec.extras, ...supportingCast, ...recurringElements]));
  const repeatMultiplier = worldActivity === "high" ? 2 : worldActivity === "medium" ? 1 : 0;

  shapes.push(
    `<g opacity="0.22">
      <path d="M68 730 C160 682, 248 676, 336 720 C430 764, 516 760, 652 706 L652 906 L68 906 Z" fill="rgba(10, 18, 28, 0.44)"/>
      <path d="M68 648 C166 594, 284 588, 372 628 C470 670, 548 660, 652 620 L652 786 L68 786 Z" fill="rgba(255,255,255,0.06)"/>
    </g>`,
  );

  extras.forEach((extra, extraIndex) => {
    const offset = 92 + extraIndex * 82;
    const stageBias = shot.title.toLowerCase().includes("threat") || shot.title.toLowerCase().includes("battle");
    const midY = stageBias ? 720 : 760;
    const backY = stageBias ? 650 : 690;
    const opacity = shot.title.toLowerCase().includes("threat") || shot.title.toLowerCase().includes("battle") ? 0.22 : 0.14;

    if (/pirate|fishermen|passersby|watchers|vendors|threat/.test(extra)) {
      shapes.push(
        `<g opacity="${opacity}">
          <circle cx="${offset}" cy="${midY - 88}" r="16" fill="rgba(255,255,255,0.22)"/>
          <rect x="${offset - 16}" y="${midY - 72}" width="32" height="78" rx="14" fill="rgba(255,255,255,0.18)"/>
          <rect x="${offset - 26}" y="${midY - 30}" width="52" height="12" rx="7" fill="rgba(255,255,255,0.12)"/>
        </g>`,
      );

      shapes.push(
        `<g opacity="${Math.max(0.09, opacity - 0.06)}" transform="translate(${offset + 34} ${backY + (extraIndex % 2) * 14}) scale(0.74)">
          <circle cx="0" cy="-88" r="16" fill="rgba(255,255,255,0.18)"/>
          <rect x="-16" y="-72" width="32" height="78" rx="14" fill="rgba(255,255,255,0.14)"/>
        </g>`,
      );
    }

    if (/boats/.test(extra)) {
      shapes.push(
        `<g opacity="0.20" transform="translate(${344 + extraIndex * 28} ${836 - extraIndex * 16})">
          <path d="M0 38 L78 38 L60 58 L18 58 Z" fill="rgba(255,255,255,0.18)"/>
          <rect x="38" y="-4" width="4" height="42" fill="rgba(255,255,255,0.16)"/>
          <path d="M42 -2 L72 18 L42 24 Z" fill="rgba(255,255,255,0.13)"/>
        </g>`,
      );
    }

    if (/nets/.test(extra)) {
      shapes.push(
        `<g opacity="0.13" transform="translate(${510 + extraIndex * 18} ${882 - extraIndex * 5})">
          <circle cx="0" cy="0" r="34" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
          <path d="M-24 -12 L24 12 M-24 12 L24 -12 M0 -34 L0 34" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
        </g>`,
      );
    }

    if (/trees|mist|lights|signs|market stalls/.test(extra)) {
      shapes.push(
        `<g opacity="0.16" transform="translate(${96 + extraIndex * 86} ${604 - extraIndex * 10})">
          <rect x="-12" y="54" width="24" height="90" rx="8" fill="rgba(255,255,255,0.12)"/>
          <circle cx="0" cy="10" r="${42 + (index % 3) * 8}" fill="rgba(255,255,255,0.10)"/>
        </g>`,
      );
    }
  });

  if (shotKind === "observer" || shotKind === "interaction" || shotKind === "landmark") {
    for (let cloneIndex = 0; cloneIndex < repeatMultiplier; cloneIndex += 1) {
      const baseX = 128 + cloneIndex * 210;
      shapes.push(
        `<g opacity="${worldActivity === "high" ? 0.18 : 0.12}">
          <circle cx="${baseX}" cy="${shotKind === "landmark" ? 656 : 704}" r="14" fill="rgba(255,255,255,0.18)"/>
          <rect x="${baseX - 14}" y="${shotKind === "landmark" ? 670 : 718}" width="28" height="70" rx="12" fill="rgba(255,255,255,0.14)"/>
          <rect x="${baseX + 30}" y="${shotKind === "landmark" ? 700 : 752}" width="44" height="18" rx="8" fill="rgba(255,255,255,0.10)"/>
        </g>`,
      );
    }
  }

  if (shotKind === "reaction") {
    shapes.push(
      `<g opacity="0.14">
        <rect x="42" y="170" width="84" height="584" rx="22" fill="rgba(0,0,0,0.20)"/>
        <rect x="594" y="146" width="84" height="610" rx="22" fill="rgba(255,255,255,0.05)"/>
      </g>`,
    );
  }

  if (subjectFraming === "shared-frame") {
    shapes.push(
      `<g opacity="0.15">
        <ellipse cx="226" cy="786" rx="78" ry="164" fill="rgba(255,255,255,0.09)"/>
        <ellipse cx="506" cy="770" rx="70" ry="154" fill="rgba(255,255,255,0.08)"/>
      </g>`,
    );
  }

  shapes.push(
    `<g opacity="0.16">
      <ellipse cx="360" cy="930" rx="280" ry="78" fill="rgba(0,0,0,0.20)"/>
      <ellipse cx="360" cy="960" rx="236" ry="52" fill="rgba(255,255,255,0.04)"/>
    </g>`,
  );

  return shapes.join("\n");
}

function buildShotReferenceSvg(
  project: MovieProject,
  shot: ShotSpec,
  index: number,
  worldSpec: ReturnType<typeof inferWorldSpec>,
  supportingCast: string[],
  recurringElements: string[],
  shotKind: HeavyJobPayload["shotReferences"][number]["shotKind"],
  subjectFraming: HeavyJobPayload["shotReferences"][number]["subjectFraming"],
  worldActivity: HeavyJobPayload["shotReferences"][number]["worldActivity"],
) {
  const template = getTemplateById(project.templateId);
  const palette = template.palette;
  const accent = palette[index % palette.length] ?? palette[0];
  const titleText = `${shot.title}`;
  const promptText = `${shot.prompt}`;
  const worldLine = `${worldSpec.setting}, ${worldSpec.landmark}, crowd mood: ${worldSpec.crowdMood}.`;
  const continuityLine = `${recurringElements.join(", ")}${recurringElements.length && supportingCast.length ? " | " : ""}${supportingCast.join(", ")}`;
  const extraShapes = renderExtraShapes(worldSpec, shot, index, supportingCast, recurringElements, shotKind, subjectFraming, worldActivity);
  const framingLine = `${shotKind.replaceAll("-", " ")} | ${subjectFraming.replaceAll("-", " ")} | ${worldActivity} world activity`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette[0]}"/>
      <stop offset="55%" stop-color="${palette[1]}"/>
      <stop offset="100%" stop-color="${palette[2]}"/>
    </linearGradient>
  </defs>
  <rect width="720" height="1280" fill="url(#bg)"/>
  <circle cx="560" cy="240" r="180" fill="rgba(255,255,255,0.08)"/>
  <circle cx="160" cy="1050" r="170" fill="rgba(255,255,255,0.06)"/>
  <rect x="44" y="48" width="632" height="1184" rx="36" fill="rgba(2,6,14,0.26)" stroke="rgba(255,255,255,0.18)"/>
  <rect x="68" y="86" width="584" height="720" rx="30" fill="rgba(255,255,255,0.04)" stroke="${accent}" stroke-opacity="0.35"/>
  <rect x="68" y="86" width="584" height="720" rx="30" fill="url(#bg)" opacity="0.16"/>
  <ellipse cx="360" cy="748" rx="250" ry="86" fill="rgba(0,0,0,0.24)"/>
  <path d="M90 760 C150 720, 240 710, 320 748 C420 792, 520 780, 630 740 L630 900 L90 900 Z" fill="rgba(6,12,20,0.42)"/>
  <circle cx="498" cy="234" r="120" fill="rgba(255,255,255,0.06)"/>
  ${extraShapes}
  <text x="86" y="132" fill="rgba(255,255,255,0.92)" font-size="24" font-family="Georgia, serif" letter-spacing="4">${escapeXml(shot.label)}</text>
  <text x="86" y="212" fill="#f8f4ee" font-size="54" font-weight="700" font-family="Georgia, serif">${escapeXml(titleText)}</text>
  <text x="86" y="874" fill="rgba(255,255,255,0.92)" font-size="24" font-family="Arial, sans-serif">STARRING ${escapeXml(project.creatorName.toUpperCase())}</text>
  <foreignObject x="84" y="912" width="552" height="180">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#f4efe8;font-family:Arial,sans-serif;font-size:28px;line-height:1.32;">
      ${escapeXml(promptText)}
    </div>
  </foreignObject>
  <foreignObject x="86" y="270" width="520" height="110">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:rgba(255,255,255,0.78);font-family:Arial,sans-serif;font-size:22px;line-height:1.28;">
      ${escapeXml(worldLine)}
    </div>
  </foreignObject>
  <foreignObject x="86" y="360" width="520" height="84">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:rgba(255,255,255,0.60);font-family:Arial,sans-serif;font-size:18px;line-height:1.28;">
      ${escapeXml(continuityLine)}
    </div>
  </foreignObject>
  <foreignObject x="86" y="434" width="520" height="62">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:rgba(255,255,255,0.52);font-family:Arial,sans-serif;font-size:16px;line-height:1.2;text-transform:uppercase;letter-spacing:1px;">
      ${escapeXml(framingLine)}
    </div>
  </foreignObject>
  <foreignObject x="84" y="1100" width="552" height="92">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:22px;line-height:1.25;">
      ${escapeXml(shot.motionHint)} | ${escapeXml(shot.composition)} | ${escapeXml(worldSpec.atmosphere)}
    </div>
  </foreignObject>
</svg>`;
}

function sourceClipOffsetForShot(index: number) {
  return Number(((index * 0.8) % 3.5).toFixed(2));
}

function stageForShot(index: number, total: number): "intro" | "battle" | "finale" {
  if (index <= 1) {
    return "intro";
  }
  if (index >= total - 2) {
    return "finale";
  }
  return "battle";
}

function continuityGroupForShot(stage: "intro" | "battle" | "finale") {
  if (stage === "intro") {
    return "setup" as const;
  }
  if (stage === "finale") {
    return "resolution" as const;
  }
  return "conflict" as const;
}

function cameraMoveForShot(index: number, stage: "intro" | "battle" | "finale") {
  if (stage === "intro") {
    return (["push-in", "pan-right", "float"] as const)[index % 3];
  }
  if (stage === "battle") {
    return (["pan-left", "push-in", "pan-right", "float"] as const)[index % 4];
  }
  return (["push-out", "float", "push-in"] as const)[index % 3];
}

function transitionStyleForShot(index: number, stage: "intro" | "battle" | "finale") {
  if (stage === "battle") {
    return (["flash", "dissolve", "drift"] as const)[index % 3];
  }
  if (stage === "finale") {
    return "dissolve" as const;
  }
  return "drift" as const;
}

function colorGradeForShot(index: number, stage: "intro" | "battle" | "finale") {
  if (stage === "intro") {
    return (["cool", "teal-orange", "neutral-night"] as const)[index % 3];
  }
  if (stage === "battle") {
    return (["teal-orange", "warm", "neutral-night"] as const)[index % 3];
  }
  return (["warm", "cool", "teal-orange"] as const)[index % 3];
}

function shotKindForShot(shot: ShotSpec) {
  if (shot.shotKind) {
    return shot.shotKind;
  }
  const text = `${shot.title} ${shot.prompt} ${shot.composition}`.toLowerCase();
  if (/(landmark|arrival|world setup)/.test(text)) {
    return "landmark" as const;
  }
  if (/(reaction|lingering look|wonder)/.test(text)) {
    return "reaction" as const;
  }
  if (/(shared|encounter|together|first sight|shared moment|local encounter)/.test(text)) {
    return "interaction" as const;
  }
  if (/(passing lives|world passing by|marketplace|world softens|observer|routine)/.test(text)) {
    return "observer" as const;
  }
  if (/(threat|counter move|battle|victory|collapse|hero focus|momentum)/.test(text)) {
    return "action" as const;
  }
  if (/(afterglow|final|identity shift|immersion)/.test(text)) {
    return "aftermath" as const;
  }
  return "establishing" as const;
}

function subjectFramingForShot(shot: ShotSpec, shotKind: ReturnType<typeof shotKindForShot>) {
  if (shot.subjectFraming) {
    return shot.subjectFraming;
  }
  if (shotKind === "reaction") {
    return "hero" as const;
  }
  if (shotKind === "observer" || shotKind === "landmark") {
    return "world-first" as const;
  }
  if (shotKind === "interaction") {
    return "shared-frame" as const;
  }
  if (/(hero-in-world|world-led|supporting world life|layered island|wide vertical)/i.test(shot.composition)) {
    return "hero-in-world" as const;
  }
  return "hero" as const;
}

function worldActivityForShot(shot: ShotSpec, shotKind: ReturnType<typeof shotKindForShot>) {
  if (shot.worldActivity) {
    return shot.worldActivity;
  }
  const text = `${shot.prompt} ${shot.composition} ${shot.motionHint}`.toLowerCase();
  if (shotKind === "observer" || shotKind === "interaction" || /(people moving|ambient world|passing|vendors|fishermen|pirates|workers|background interactions)/.test(text)) {
    return "high" as const;
  }
  if (shotKind === "landmark" || shotKind === "action" || /(living world|supporting cast|world texture)/.test(text)) {
    return "medium" as const;
  }
  return "low" as const;
}

function motionEnergyForShot(
  shot: ShotSpec,
  shotKind: ReturnType<typeof shotKindForShot>,
  continuityGroup: ReturnType<typeof continuityGroupForShot>,
) {
  const text = `${shot.motionHint} ${shot.prompt}`.toLowerCase();
  if (shotKind === "action" || continuityGroup === "conflict" || /(explosive|impact|velocity|pressure|fast)/.test(text)) {
    return "kinetic" as const;
  }
  if (shotKind === "observer" || shotKind === "interaction" || /(drift|passing|fluid|measured|ambient)/.test(text)) {
    return "steady" as const;
  }
  return "gentle" as const;
}

function inferCharacterBible(project: MovieProject, worldSpec: ReturnType<typeof inferWorldSpec>) {
  const text = `${project.persona} ${project.premise} ${project.scenePrompt}`.toLowerCase();
  const heroDisplayName = project.creatorName;
  const identityAnchor = `${project.creatorName} as the same lead character across all shots`;
  const wardrobeAnchor =
    /(pirate|island|harbor|sea)/.test(text)
      ? "wind-touched adventure wardrobe with grounded natural textures"
      : /(fight|kung fu|battle|gang)/.test(text)
        ? "hero-ready street action wardrobe with strong silhouette"
        : /(love|romance)/.test(text)
          ? "clean romantic wardrobe with soft elegant styling"
          : "grounded cinematic wardrobe with a memorable silhouette";
  const physicalFeatures = [
    "same face shape and skin tone across every shot",
    "recognizable eyes and expression",
    "consistent hairline and head shape",
  ];
  const screenPresence =
    /(fight|kung fu|battle)/.test(text)
      ? "commanding action-lead presence"
      : /(love|romance)/.test(text)
        ? "quiet magnetic romantic-lead presence"
        : /(adventure|quest|journey|pirate)/.test(text)
          ? "curious heroic explorer presence"
          : "cinematic lead presence";
  const movementStyle =
    /(fight|kung fu|battle)/.test(text)
      ? "precise, athletic, expressive movement"
      : /(love|romance)/.test(text)
        ? "gentle, emotionally readable movement"
        : "natural movie-character movement";
  const performanceEnergy =
    /(fight|kung fu|battle)/.test(text)
      ? "intense, controlled, physically confident"
      : /(love|romance)/.test(text)
        ? "warm, sincere, emotionally open"
        : worldSpec.crowdMood === "restless and alert"
          ? "focused and alert"
          : "grounded and cinematic";

  return {
    heroDisplayName,
    identityAnchor,
    wardrobeAnchor,
    physicalFeatures,
    screenPresence,
    movementStyle,
    performanceEnergy,
  };
}

function inferStyleBible(project: MovieProject, worldSpec: ReturnType<typeof inferWorldSpec>) {
  const template = getTemplateById(project.templateId);
  const text = `${project.genre} ${project.premise} ${project.scenePrompt} ${project.persona}`.toLowerCase();

  const cinematicTone =
    /(fight|kung fu|battle|gang|war)/.test(text)
      ? "grounded action-drama with heroic intensity"
      : /(love|romance|memory|confessional)/.test(text)
        ? "intimate emotional cinema with polished realism"
        : /(adventure|pirate|journey|quest|island|legend)/.test(text)
          ? "big-screen adventure realism with cinematic wonder"
          : `${template.name.toLowerCase()} tone with grounded live-action realism`;

  const lensLanguage =
    /(fight|kung fu|battle)/.test(text)
      ? "mix of wide environmental shots, medium hero shots, and occasional close reaction shots; 28mm to 85mm live-action lens feeling"
      : /(love|romance)/.test(text)
        ? "gentle close-ups, medium two-shots, and soft background separation; 50mm to 85mm lens feeling"
        : /(adventure|island|pirate|forest|city)/.test(text)
          ? "wide establishing frames that still keep the hero readable, then medium cinematic coverage; 24mm to 50mm lens feeling"
          : "cinematic lens variation with readable hero coverage and world depth";

  const lightingLanguage =
    /(fight|kung fu|battle)/.test(text)
      ? "directional contrast lighting, strong edge light, believable practical highlights, dramatic but realistic exposure"
      : /(love|romance)/.test(text)
        ? "soft flattering key light, gentle falloff, warm practicals, realistic skin tones"
        : worldSpec.atmosphere.includes("haze")
          ? "atmospheric backlight, natural haze, sunlight shafts, realistic cinematic diffusion"
          : "believable live-action lighting with controlled contrast and depth";

  const editRhythm =
    /(fight|kung fu|battle)/.test(text)
      ? "clear visual geography, measured build, sharper mid-scene cuts, then a satisfying heroic release"
      : /(adventure|pirate|quest)/.test(text)
        ? "wonder first, movement second, escalation in the middle, poster-like ending"
        : /(love|romance|memory)/.test(text)
          ? "gentle lyrical pacing, emotional pauses, soft transitions"
          : "cinematic pacing with readable escalation and a confident ending";

  const cameraBehavior =
    /(fight|kung fu|battle)/.test(text)
      ? "camera feels intentional and athletic, never chaotic; push-ins, lateral motion, and readable action framing"
      : /(adventure|pirate|quest|island)/.test(text)
        ? "camera discovers the world with the hero, mixing drift, push-ins, and world-revealing motion"
        : /(love|romance)/.test(text)
          ? "camera feels close, observant, and emotionally patient"
          : "camera feels deliberate, cinematic, and story-led";

  const textureGoal =
    /(island|pirate|sea|harbor)/.test(text)
      ? "salt air, fabric texture, weathered wood, believable environment detail"
      : /(forest|jungle|savanna)/.test(text)
        ? "organic foliage detail, mist, layered depth, realistic outdoor texture"
        : /(city|street|market)/.test(text)
          ? "street texture, layered signage, practical light sources, believable crowd life"
          : "believable live-action texture with cinematic polish";

  const scoreMood =
    /(fight|kung fu|battle)/.test(text)
      ? "rising percussion, tension, release"
      : /(love|romance)/.test(text)
        ? "warm emotional swell with intimate restraint"
        : /(adventure|pirate|quest)/.test(text)
          ? "expansive adventurous lift with mystery underneath"
          : "cinematic emotional score arc";

  return {
    cinematicTone,
    lensLanguage,
    lightingLanguage,
    editRhythm,
    cameraBehavior,
    textureGoal,
    scoreMood,
  };
}

function emotionalBeatForShot(
  shot: ShotSpec,
  stage: "intro" | "battle" | "finale",
  shotKind: ReturnType<typeof shotKindForShot>,
) {
  const text = `${shot.title} ${shot.prompt}`.toLowerCase();
  if (stage === "intro") {
    return /(wonder|arrival|first sight|discovery)/.test(text) ? "discovery and awe" : "arrival and anticipation";
  }
  if (stage === "finale") {
    return /(victory|promise|afterglow|legend|future)/.test(text)
      ? "earned triumph and legacy"
      : "resolution and emotional payoff";
  }
  if (shotKind === "reaction") {
    return "personal reaction under pressure";
  }
  if (shotKind === "interaction") {
    return "charged human connection";
  }
  if (shotKind === "action") {
    return "conflict and forward momentum";
  }
  return "rising tension inside a living world";
}

function cameraGoalForShot(
  stage: "intro" | "battle" | "finale",
  shotKind: ReturnType<typeof shotKindForShot>,
  subjectFraming: ReturnType<typeof subjectFramingForShot>,
) {
  if (stage === "intro" && subjectFraming === "world-first") {
    return "introduce the world before landing on the hero";
  }
  if (shotKind === "interaction") {
    return "keep the hero connected to another person or force in the frame";
  }
  if (shotKind === "reaction") {
    return "read the face clearly and hold emotional detail";
  }
  if (stage === "finale") {
    return "end on a poster-ready image with strong emotional closure";
  }
  return "keep the hero legible while preserving cinematic world scale";
}

function backgroundActionForShot(
  worldSpec: ReturnType<typeof inferWorldSpec>,
  worldActivity: ReturnType<typeof worldActivityForShot>,
  shotKind: ReturnType<typeof shotKindForShot>,
) {
  const extras = worldSpec.extras.slice(0, worldActivity === "high" ? 4 : 2).join(", ");
  if (shotKind === "reaction") {
    return `subtle world motion behind the hero: ${extras || "ambient movement"}`;
  }
  if (shotKind === "interaction") {
    return `supporting characters continue moving naturally in the background: ${extras || "ambient crowd movement"}`;
  }
  return `visible background life sells the scene: ${extras || "environmental motion and atmosphere"}`;
}

function heroActionForShot(shot: ShotSpec, shotKind: ReturnType<typeof shotKindForShot>) {
  const text = `${shot.title} ${shot.prompt} ${shot.motionHint}`.toLowerCase();
  if (shotKind === "action") {
    return /(fight|kick|strike|kung fu|battle)/.test(text)
      ? "hero executes a readable physical action with confidence and clean body language"
      : "hero drives the moment with strong physical intent";
  }
  if (shotKind === "interaction") {
    return "hero shares the frame with another person or force while staying visually dominant";
  }
  if (shotKind === "reaction") {
    return "hero holds a clear emotional expression that the audience can read immediately";
  }
  if (shotKind === "landmark") {
    return "hero enters or stands inside the world as if the place is larger than life";
  }
  return "hero remains the cinematic center of gravity";
}

function lensSuggestionForShot(
  stage: "intro" | "battle" | "finale",
  shotKind: ReturnType<typeof shotKindForShot>,
  subjectFraming: ReturnType<typeof subjectFramingForShot>,
) {
  if (subjectFraming === "world-first" || shotKind === "landmark") {
    return "24mm to 35mm wide live-action lens feeling";
  }
  if (shotKind === "reaction") {
    return "65mm to 85mm portrait lens feeling";
  }
  if (shotKind === "interaction") {
    return "40mm to 50mm medium cinematic lens feeling";
  }
  if (stage === "battle") {
    return "35mm to 50mm action-friendly lens feeling with readable movement";
  }
  return "35mm to 65mm cinematic lens feeling";
}

function lightingCueForShot(
  stage: "intro" | "battle" | "finale",
  colorGrade: ReturnType<typeof colorGradeForShot>,
  worldSpec: ReturnType<typeof inferWorldSpec>,
) {
  const base =
    colorGrade === "warm"
      ? "warm practical highlights and flattering key light"
      : colorGrade === "cool"
        ? "cooler directional light with controlled contrast"
        : colorGrade === "teal-orange"
          ? "teal shadow separation and warm highlights with believable exposure"
          : "neutral night realism with readable skin tones";

  if (stage === "battle") {
    return `${base}; stronger edge light and tension-friendly contrast`;
  }
  if (stage === "finale") {
    return `${base}; poster-ready separation and heroic glow`;
  }
  return `${base}; atmosphere shaped by ${worldSpec.atmosphere}`;
}

function editInstructionForShot(
  stage: "intro" | "battle" | "finale",
  shotKind: ReturnType<typeof shotKindForShot>,
  motionEnergy: ReturnType<typeof motionEnergyForShot>,
) {
  if (stage === "intro") {
    return "cut should feel like a measured opening reveal";
  }
  if (stage === "finale") {
    return "cut should land like the final image of a trailer";
  }
  if (shotKind === "action" || motionEnergy === "kinetic") {
    return "cut should add momentum without losing spatial clarity";
  }
  if (shotKind === "reaction") {
    return "hold long enough for the audience to read the face before moving on";
  }
  return "cut should preserve continuity and emotional escalation";
}

function negativePromptForShot(
  shotKind: ReturnType<typeof shotKindForShot>,
  subjectFraming: ReturnType<typeof subjectFramingForShot>,
  worldActivity: ReturnType<typeof worldActivityForShot>,
) {
  const items = [
    "blurry",
    "low quality",
    "deformed anatomy",
    "duplicate face",
    "extra limbs",
    "plastic skin",
    "cartoon look",
    "text artifacts",
    "watermark",
  ];

  if (shotKind === "action") {
    items.push("unclear action pose", "broken hands", "twisted limbs");
  }
  if (subjectFraming === "world-first") {
    items.push("floating hero", "disconnected scale");
  }
  if (worldActivity === "high") {
    items.push("empty background", "missing crowd life");
  }

  return items.join(", ");
}

export async function createHeavyJobFiles(project: MovieProject, provider: HeavyRenderProviderId) {
  await ensureJobsDir();
  const dir = jobDir(project.workerJob?.id ?? `job-${project.id}`);
  await fs.mkdir(dir, { recursive: true });
  const referencesDir = path.join(dir, "references");
  await fs.mkdir(referencesDir, { recursive: true });

  const payloadPath = path.join(dir, "payload.json");
  const resultPath = path.join(dir, "result.json");
  const statusPath = path.join(dir, "status.json");
  const sourceVideoPath = publicUrlToAbsolutePath(project.sourceVideoUrl) ?? project.sourceVideoUrl;
  const sourceImagePath = publicUrlToAbsolutePath(project.sourceImageUrl);
  const posterPath = publicUrlToAbsolutePath(project.posterUrl) ?? project.posterUrl;
  const worldSpec = inferWorldSpec(project);
  const styleBible = inferStyleBible(project, worldSpec);
  const characterBible = inferCharacterBible(project, worldSpec);

  const draftedShotReferences = await Promise.all(
    project.shotPlan.map(async (shot, index) => {
      const stage = stageForShot(index, project.shotPlan.length);
      const continuityGroup = continuityGroupForShot(stage);
      const shotKind = shotKindForShot(shot);
      const subjectFraming = subjectFramingForShot(shot, shotKind);
      const worldActivity = worldActivityForShot(shot, shotKind);
      const motionEnergy = motionEnergyForShot(shot, shotKind, continuityGroup);
      const recurringElements = worldSpec.recurringMotifs.slice(0, 2 + (index % 2));
      const supportingCast = worldSpec.supportingCast.slice(0, 1 + ((stage === "battle" || stage === "finale") ? 1 : 0));
      const emotionalBeat = emotionalBeatForShot(shot, stage, shotKind);
      const continuityAnchor = `${stage}-${subjectFraming}-${worldSpec.setting}-${characterBible.wardrobeAnchor}`;
      const cameraGoal = cameraGoalForShot(stage, shotKind, subjectFraming);
      const heroAction = heroActionForShot(shot, shotKind);
      const lensSuggestion = lensSuggestionForShot(stage, shotKind, subjectFraming);
      const colorGrade = colorGradeForShot(index, stage);
      const lightingCue = lightingCueForShot(stage, colorGrade, worldSpec);
      const editInstruction = editInstructionForShot(stage, shotKind, motionEnergy);
      const negativePrompt = negativePromptForShot(shotKind, subjectFraming, worldActivity);
      const backgroundAction = backgroundActionForShot(worldSpec, worldActivity, shotKind);
      const referenceSvgPath = path.join(referencesDir, `${String(index + 1).padStart(2, "0")}-${shot.id}.svg`);
      const referencePngPath = path.join(referencesDir, `${String(index + 1).padStart(2, "0")}-${shot.id}.png`);
      await fs.writeFile(
        referenceSvgPath,
        buildShotReferenceSvg(project, shot, index, worldSpec, supportingCast, recurringElements, shotKind, subjectFraming, worldActivity),
        "utf8",
      );
      await sharp(referenceSvgPath).png().toFile(referencePngPath);
      return {
        shotId: shot.id,
        index,
        title: shot.title,
        prompt: shot.prompt,
        durationSeconds: shot.durationSeconds,
        motionHint: shot.motionHint,
        composition: shot.composition,
        sourceClipOffsetSeconds: sourceClipOffsetForShot(index),
        stage,
        continuityGroup,
        continuityAnchor,
        emotionalBeat,
        cameraGoal,
        backgroundAction,
        heroAction,
        lensSuggestion,
        lightingCue,
        editInstruction,
        negativePrompt,
        transitionStyle: transitionStyleForShot(index, stage),
        cameraMove: cameraMoveForShot(index, stage),
        colorGrade,
        shotKind,
        subjectFraming,
        worldActivity,
        motionEnergy,
        recurringElements,
        supportingCast,
        referenceSvgPath,
        referencePngPath,
        conditioningImages: [referencePngPath].filter(Boolean),
      };
    }),
  );

  const shotReferences = draftedShotReferences.map((shot, index, allShots) => ({
    ...shot,
    previousShotSummary:
      index > 0
        ? `${allShots[index - 1].title}: ${allShots[index - 1].emotionalBeat}; ${allShots[index - 1].cameraGoal}.`
        : undefined,
    nextShotSummary:
      index < allShots.length - 1
        ? `${allShots[index + 1].title}: ${allShots[index + 1].emotionalBeat}; ${allShots[index + 1].cameraGoal}.`
        : undefined,
  }));

  const payload: HeavyJobPayload = {
    protocolVersion: "pulsereel-heavy-job-v1",
    jobId: project.workerJob?.id ?? `job-${project.id}`,
    projectId: project.id,
    slug: project.slug,
    provider,
    createdAt: new Date().toISOString(),
    jobRoot: dir,
    outputSpec: {
      width: 720,
      height: 1280,
      fps: 25,
      totalDurationSeconds: project.shotPlan.reduce((total, shot) => total + shot.durationSeconds, 0),
      aspectRatio: "9:16",
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audio: "optional",
    },
    modelHints: {
      workflow: "shot-to-video",
      preferredMotionBackend: "open-source-local",
      fallbackBehavior: "use-local-motion-runner",
      qualityPriority: "motion-consistency-over-photorealism",
      bridgeTarget: process.env.PULSEREEL_PYTHON_EXECUTABLE ? "python-runner" : "node-runner",
      recommendedBackends: ["ComfyUI", "Wan 2.1", "CogVideoX", "Stable Video Diffusion"],
      backendCommandTemplateEnv: "PULSEREEL_MODEL_BACKEND_COMMAND",
      pythonBridgeScript: path.join(process.cwd(), "scripts", "python-motion-bridge.py"),
      comfyUiUrlEnv: "PULSEREEL_COMFYUI_URL",
      comfyUiWorkflowEnv: "PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE",
    },
    assets: {
      sourceVideoUrl: project.sourceVideoUrl,
      sourceImageUrl: project.sourceImageUrl,
      posterUrl: project.posterUrl,
      sourceVideoPath,
      sourceImagePath,
      posterPath,
      referencesDir,
    },
    story: {
      title: project.title,
      creatorName: project.creatorName,
      templateId: project.templateId,
      genre: project.genre,
      premise: project.premise,
      scenePrompt: project.scenePrompt,
      persona: project.persona,
      caption: project.caption,
      hook: project.hook,
      openingShot: project.openingShot,
      scenePrompts: project.scenePrompts,
      visualIntent: {
        heroLook: characterBible.wardrobeAnchor,
        worldScale:
          shotReferences.some((shot) => shot.subjectFraming === "world-first" || shot.subjectFraming === "hero-in-world")
            ? "hero grounded inside a believable larger world"
            : "hero-forward framing with cinematic depth",
        pacing:
          shotReferences.some((shot) => shot.motionEnergy === "kinetic")
            ? "starts readable, builds to kinetic peaks, resolves on a strong closing image"
            : "measured cinematic pacing with emotional escalation",
        realismTarget: "believable live-action scene continuity, not poster-only imagery",
        performanceNote: characterBible.performanceEnergy,
      },
    },
    styleBible,
    characterBible,
    worldSpec,
    shotReferences,
    shots: project.shotPlan,
  };

  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(
    statusPath,
    JSON.stringify(
      {
        jobId: payload.jobId,
        provider,
        status: "queued",
        stage: "Job package written",
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return { dir, payloadPath, resultPath, statusPath, payload };
}

export async function readHeavyJobPayload(payloadPath: string) {
  const raw = await fs.readFile(payloadPath, "utf8");
  return JSON.parse(raw) as HeavyJobPayload;
}

export async function updateHeavyJobStatus(
  statusPath: string,
  data: { provider: HeavyRenderProviderId; status: string; stage: string; progress?: number; error?: string },
) {
  await fs.writeFile(
    statusPath,
    JSON.stringify(
      {
        ...data,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function writeHeavyJobResult(resultPath: string, result: HeavyJobResult) {
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
}

export async function readHeavyJobResult(resultPath: string) {
  try {
    const raw = await fs.readFile(resultPath, "utf8");
    return JSON.parse(raw) as HeavyJobResult;
  } catch {
    return null;
  }
}

type RunnerExecutionResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
};

async function appendFileIfExists(formData: FormData, fieldName: string, filePath?: string) {
  if (!filePath) {
    return;
  }

  try {
    const bytes = await fs.readFile(filePath);
    const blob = new Blob([bytes]);
    formData.append(fieldName, blob, path.basename(filePath));
  } catch {
    return;
  }
}

async function writeBase64Video(outputBase64: string, jobId: string) {
  const generatedDir = getRuntimeAssetDir("generated");
  await fs.mkdir(generatedDir, { recursive: true });
  const outputFilename = `${jobId}-remote-model.mp4`;
  const outputPath = path.join(generatedDir, outputFilename);
  await fs.writeFile(outputPath, Buffer.from(outputBase64, "base64"));
  return runtimeAssetUrl("generated", outputFilename);
}

async function executeRemoteModelBackend(input: {
  payloadPath: string;
  resultPath: string;
  statusPath: string;
}): Promise<RunnerExecutionResult | null> {
  const remoteUrl = process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim();
  if (!remoteUrl) {
    return null;
  }

  const token = process.env.PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN?.trim();
  const payload = await readHeavyJobPayload(input.payloadPath);
  const formData = new FormData();
  formData.append("payload", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "payload.json");
  formData.append("protocolVersion", payload.protocolVersion);
  formData.append("jobId", payload.jobId);

  await appendFileIfExists(formData, "sourceVideo", payload.assets.sourceVideoPath);
  await appendFileIfExists(formData, "sourceImage", payload.assets.sourceImagePath);
  await appendFileIfExists(formData, "poster", payload.assets.posterPath);

  for (const shot of payload.shotReferences) {
    await appendFileIfExists(formData, `reference_${shot.index}`, shot.referencePngPath);
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(remoteUrl, {
    method: "POST",
    body: formData,
    headers,
  });
  const responseText = await response.text();

  if (!response.ok) {
    return {
      exitCode: 1,
      stdout: responseText,
      stderr: `Remote model backend returned ${response.status}: ${responseText}`,
      command: `POST ${remoteUrl}`,
    };
  }

  let remoteResult: {
    status?: "completed" | "failed";
    processedVideoUrl?: string;
    videoBase64?: string;
    shotPlan?: HeavyJobResult["shotPlan"];
    error?: string;
  };

  try {
    remoteResult = JSON.parse(responseText);
  } catch {
    return {
      exitCode: 1,
      stdout: responseText,
      stderr: "Remote model backend did not return JSON.",
      command: `POST ${remoteUrl}`,
    };
  }

  if (remoteResult.status === "failed") {
    await writeHeavyJobResult(input.resultPath, {
      jobId: payload.jobId,
      provider: payload.provider,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: remoteResult.error || "Remote model backend failed.",
    });
    return {
      exitCode: 1,
      stdout: responseText,
      stderr: remoteResult.error || "Remote model backend failed.",
      command: `POST ${remoteUrl}`,
    };
  }

  const processedVideoUrl = remoteResult.processedVideoUrl ||
    (remoteResult.videoBase64 ? await writeBase64Video(remoteResult.videoBase64, payload.jobId) : undefined);

  if (!processedVideoUrl) {
    return {
      exitCode: 1,
      stdout: responseText,
      stderr: "Remote model backend returned no processedVideoUrl or videoBase64.",
      command: `POST ${remoteUrl}`,
    };
  }

  await writeHeavyJobResult(input.resultPath, {
    jobId: payload.jobId,
    provider: payload.provider,
    status: "completed",
    completedAt: new Date().toISOString(),
    processedVideoUrl,
    shotPlan: remoteResult.shotPlan ?? payload.shots,
  });

  return {
    exitCode: 0,
    stdout: responseText,
    stderr: "",
    command: `POST ${remoteUrl}`,
  };
}

function buildRunnerCommand(payloadPath: string, resultPath: string, statusPath: string) {
  const configured = process.env.PULSEREEL_OPEN_MODEL_RUNNER?.trim();
  const pythonExecutable = process.env.PULSEREEL_PYTHON_EXECUTABLE?.trim();
  const pythonScript = path.join(process.cwd(), "scripts", "python-motion-bridge.py");
  const bundledScript = path.join(process.cwd(), "scripts", "local-motion-runner.mjs");
  const commandTemplate = configured
    || (pythonExecutable
      ? `"${pythonExecutable}" "${pythonScript}" "{payload}" "{result}" "{status}"`
      : `node "${bundledScript}" "{payload}" "{result}" "{status}"`);

  return commandTemplate
    .replaceAll("{payload}", payloadPath)
    .replaceAll("{result}", resultPath)
    .replaceAll("{status}", statusPath);
}

export async function executeHeavyRunnerCommand(input: {
  payloadPath: string;
  resultPath: string;
  statusPath: string;
}) {
  const remoteResult = await executeRemoteModelBackend(input);
  if (remoteResult) {
    return remoteResult;
  }

  const command = buildRunnerCommand(input.payloadPath, input.resultPath, input.statusPath);

  return new Promise<RunnerExecutionResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        command,
      }),
    );
  });
}
