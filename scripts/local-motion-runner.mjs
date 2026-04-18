import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static");

function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function runtimeAssetDir(folder) {
  return isVercelRuntime()
    ? path.join("/tmp", "pulsereel", "public", folder)
    : path.join(process.cwd(), "public", folder);
}

function runtimeAssetUrl(folder, filename) {
  return `/api/assets/${folder}/${filename}`;
}

function resolveFfmpegPath() {
  const candidates = [
    ffmpegStatic,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter(Boolean);

  return candidates[0];
}

function runFfmpeg(args) {
  const ffmpegPath = resolveFfmpegPath();

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function updateStatus(statusPath, status) {
  await fs.writeFile(
    statusPath,
    JSON.stringify(
      {
        ...status,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function colorFilterForShot(shot) {
  switch (shot.colorGrade) {
    case "warm":
      return "eq=saturation=1.18:contrast=1.05:brightness=0.03:gamma_r=1.04:gamma_b=0.96";
    case "cool":
      return "eq=saturation=1.08:contrast=1.04:brightness=0.01:gamma_r=0.96:gamma_b=1.06";
    case "teal-orange":
      return "eq=saturation=1.22:contrast=1.08:brightness=0.02";
    default:
      return "eq=saturation=1.06:contrast=1.03:brightness=0.00";
  }
}

function additionalLookFilterForShot(shot) {
  const parts = [];

  if ((shot.recurringElements || []).some((element) => /haze|mist|salt-air/i.test(element))) {
    parts.push("gblur=sigma=0.5");
  }

  if ((shot.supportingCast || []).length > 0) {
    parts.push("eq=contrast=1.06");
  }

  if ((shot.recurringElements || []).some((element) => /lantern|market/i.test(element))) {
    parts.push("curves=preset=strong_contrast");
  }

  return parts;
}

function shotFocusXExpression(shot) {
  switch (shot.subjectFraming) {
    case "world-first":
      return "iw/2-(iw/zoom/2)+sin(on/8)*36";
    case "shared-frame":
      return "iw/2-(iw/zoom/2)+sin(on/10)*18";
    case "hero-in-world":
      return "iw/2-(iw/zoom/2)+sin(on/12)*12";
    default:
      return "iw/2-(iw/zoom/2)";
  }
}

function shotFocusYExpression(shot) {
  switch (shot.subjectFraming) {
    case "world-first":
      return "ih/2-(ih/zoom/2)-18+cos(on/12)*14";
    case "shared-frame":
      return "ih/2-(ih/zoom/2)+cos(on/11)*12";
    default:
      return "ih/2-(ih/zoom/2)+cos(on/14)*8";
  }
}

function zoomExpressionForShot(shot) {
  if (shot.subjectFraming === "world-first") {
    return shot.motionEnergy === "steady" ? "1.04+0.0002*on" : "1.06";
  }
  if (shot.subjectFraming === "shared-frame") {
    return "1.07+0.0003*sin(on/10)";
  }
  switch (shot.cameraMove) {
    case "push-out":
      return "1.14-0.0008*on";
    case "pan-left":
    case "pan-right":
      return "1.08";
    case "float":
      return "1.06+0.0002*sin(on/9)";
    default:
      return "1+0.0008*on";
  }
}

function xExpressionForShot(shot) {
  if (shot.subjectFraming === "world-first" || shot.subjectFraming === "shared-frame") {
    return shotFocusXExpression(shot);
  }
  switch (shot.cameraMove) {
    case "pan-left":
      return "iw/2-(iw/zoom/2)-sin(on/9)*28";
    case "pan-right":
      return "iw/2-(iw/zoom/2)+sin(on/9)*28";
    case "float":
      return "iw/2-(iw/zoom/2)+sin(on/11)*10";
    default:
      return "iw/2-(iw/zoom/2)";
  }
}

function yExpressionForShot(shot) {
  if (shot.subjectFraming === "world-first" || shot.subjectFraming === "shared-frame") {
    return shotFocusYExpression(shot);
  }
  switch (shot.stage) {
    case "finale":
      return "ih/2-(ih/zoom/2)-cos(on/13)*8";
    case "battle":
      return "ih/2-(ih/zoom/2)+cos(on/10)*18";
    default:
      return "ih/2-(ih/zoom/2)+cos(on/16)*10";
  }
}

function fadeInDuration(shot) {
  if (shot.motionEnergy === "gentle") {
    return Math.max(0.42, shot.transitionStyle === "drift" ? 0.62 : 0.42);
  }
  return shot.transitionStyle === "flash" ? 0.18 : shot.transitionStyle === "drift" ? 0.55 : 0.35;
}

function fadeOutDuration(shot) {
  if (shot.motionEnergy === "gentle") {
    return Math.max(0.5, shot.transitionStyle === "drift" ? 0.72 : 0.5);
  }
  return shot.transitionStyle === "flash" ? 0.22 : shot.transitionStyle === "drift" ? 0.65 : 0.42;
}

function shouldAddMotionInsert(shot, index, total) {
  if (index >= total - 1) {
    return false;
  }

  return (
    shot.continuityGroup === "conflict" ||
    shot.worldActivity === "high" ||
    shot.shotKind === "interaction" ||
    shot.shotKind === "observer" ||
    (shot.subjectFraming === "world-first" && index % 2 === 1) ||
    index % 4 === 2
  );
}

function motionInsertDurationForShot(shot) {
  const baseDuration = Number(shot.durationSeconds || 5);
  const insertDuration =
    shot.shotKind === "interaction"
      ? 2.2
      : shot.shotKind === "observer" || shot.worldActivity === "high"
        ? 1.8
        : shot.motionEnergy === "kinetic"
          ? 1.6
          : 1.25;

  return Math.min(Math.max(1, insertDuration), Math.max(1, baseDuration - 1.4));
}

function statusPhraseForShot(shot) {
  if (shot.shotKind === "observer" || shot.subjectFraming === "world-first") {
    return "world-life beat";
  }
  if (shot.shotKind === "interaction" || shot.subjectFraming === "shared-frame") {
    return "interaction beat";
  }
  if (shot.shotKind === "reaction") {
    return "reaction beat";
  }
  return "cinematic beat";
}

async function renderStillShot(referencePngPath, outputPath, shot, outputSpec) {
  const fps = outputSpec.fps || 25;
  const durationSeconds = shot.durationSeconds || 5;
  const width = outputSpec.width || 720;
  const height = outputSpec.height || 1280;
  const fadeIn = fadeInDuration(shot);
  const fadeOut = fadeOutDuration(shot);

  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `zoompan=z='${zoomExpressionForShot(shot)}':x='${xExpressionForShot(shot)}':y='${yExpressionForShot(shot)}':d=${Math.max(1, Math.round(durationSeconds * fps))}:s=${width}x${height}:fps=${fps}`,
    colorFilterForShot(shot),
    ...additionalLookFilterForShot(shot),
    "unsharp=5:5:0.5:5:5:0.0",
    "format=yuv420p",
    `fade=t=in:st=0:d=${fadeIn}`,
    `fade=t=out:st=${Math.max(0.5, durationSeconds - fadeOut)}:d=${fadeOut}`,
  ].join(",");

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-i",
    referencePngPath,
    "-vf",
    vf,
    "-t",
    `${durationSeconds}`,
    "-r",
    `${fps}`,
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath,
  ]);
}

async function renderSourceMotion(sourceVideoPath, outputPath, shot, outputSpec, durationOverride) {
  const fps = outputSpec.fps || 25;
  const durationSeconds = durationOverride || shot.durationSeconds || 5;
  const width = outputSpec.width || 720;
  const height = outputSpec.height || 1280;
  const fadeIn = Math.min(0.22, fadeInDuration(shot));
  const fadeOut = Math.min(0.3, fadeOutDuration(shot));
  const cropX =
    shot.subjectFraming === "world-first"
      ? "x=(in_w-out_w)/2+sin(t*0.9)*52"
      : shot.subjectFraming === "shared-frame"
        ? "x=(in_w-out_w)/2+sin(t*0.7)*24"
        : "x=(in_w-out_w)/2";
  const cropY =
    shot.subjectFraming === "world-first"
      ? "y=(in_h-out_h)/2-26+cos(t*0.7)*18"
      : shot.shotKind === "reaction"
        ? "y=(in_h-out_h)/2-10"
        : "y=(in_h-out_h)/2";
  const motionTexture =
    shot.shotKind === "observer" || shot.worldActivity === "high"
      ? "tblend=all_mode=average:all_opacity=0.16"
      : shot.motionEnergy === "kinetic"
        ? "tblend=all_mode=average:all_opacity=0.12"
        : "tblend=all_mode=average:all_opacity=0.07";

  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:${cropX}:${cropY}`,
    colorFilterForShot(shot),
    ...additionalLookFilterForShot(shot),
    "eq=saturation=1.14:contrast=1.05:brightness=0.01",
    "unsharp=5:5:0.6:5:5:0.0",
    motionTexture,
    `fade=t=in:st=0:d=${fadeIn}`,
    `fade=t=out:st=${Math.max(0.4, durationSeconds - fadeOut)}:d=${fadeOut}`,
    "format=yuv420p",
  ].join(",");

  await runFfmpeg([
    "-y",
    "-ss",
    `${shot.sourceClipOffsetSeconds || 0}`,
    "-i",
    sourceVideoPath,
    "-t",
    `${durationSeconds}`,
    "-vf",
    vf,
    "-an",
    "-r",
    `${fps}`,
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}

async function concatSegments(segmentPaths, concatListPath, outputPath, outputSpec) {
  const fps = outputSpec.fps || 25;
  const totalDurationSeconds = outputSpec.totalDurationSeconds || 60;
  const fileList = segmentPaths.map((segmentPath) => `file '${segmentPath.replace(/'/g, "''")}'`).join("\n");
  await fs.writeFile(concatListPath, fileList, "utf8");

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    `${fps}`,
    "-t",
    `${totalDurationSeconds}`,
    "-movflags",
    "+faststart",
    "-an",
    outputPath,
  ]);
}

async function main() {
  const [payloadPath, resultPath, statusPath] = process.argv.slice(2);

  if (!payloadPath || !resultPath || !statusPath) {
    throw new Error("Usage: node scripts/local-motion-runner.mjs <payloadPath> <resultPath> <statusPath>");
  }

  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  const jobRoot = payload.jobRoot || path.dirname(payloadPath);
  const rendersDir = path.join(jobRoot, "runner-renders");
  await fs.mkdir(rendersDir, { recursive: true });

  await updateStatus(statusPath, {
    jobId: payload.jobId,
    provider: "open-model-adapter",
    status: "running",
    stage: "Local motion runner preparing cinematic shot sequence",
    progress: 24,
  });

  const segmentPaths = [];
  for (let index = 0; index < payload.shotReferences.length; index += 1) {
    const shot = payload.shotReferences[index];
    const shotOutput = path.join(rendersDir, `${String(index + 1).padStart(2, "0")}-${shot.shotId}.mp4`);
    const shouldAddMotion = shouldAddMotionInsert(shot, index, payload.shotReferences.length);
    const motionDuration =
      shouldAddMotion && payload.assets.sourceVideoPath ? motionInsertDurationForShot(shot) : 0;
    const stillShot = {
      ...shot,
      durationSeconds: Math.max(1, Number(shot.durationSeconds || 5) - motionDuration),
    };

    await renderStillShot(shot.referencePngPath, shotOutput, stillShot, payload.outputSpec || {});
    segmentPaths.push(shotOutput);

    if (shouldAddMotion && payload.assets.sourceVideoPath) {
      const motionOutput = path.join(rendersDir, `${String(index + 1).padStart(2, "0")}-${shot.shotId}-motion.mp4`);
      await renderSourceMotion(payload.assets.sourceVideoPath, motionOutput, shot, payload.outputSpec || {}, motionDuration);
      segmentPaths.push(motionOutput);
    }

    await updateStatus(statusPath, {
      jobId: payload.jobId,
      provider: "open-model-adapter",
      status: "running",
      stage: `Rendering ${statusPhraseForShot(shot)} ${index + 1} of ${payload.shotReferences.length}`,
      progress: Math.min(82, 28 + Math.floor(((index + 1) / payload.shotReferences.length) * 50)),
    });
  }

  const generatedDir = runtimeAssetDir("generated");
  await fs.mkdir(generatedDir, { recursive: true });
  const outputFilename = `${payload.jobId}-open-model.mp4`;
  const outputPath = path.join(generatedDir, outputFilename);
  const concatListPath = path.join(rendersDir, "concat.txt");

  await updateStatus(statusPath, {
    jobId: payload.jobId,
    provider: "open-model-adapter",
    status: "running",
    stage: "Joining cinematic shots with smoother continuity",
    progress: 88,
  });

  await concatSegments(segmentPaths, concatListPath, outputPath, payload.outputSpec || {});

  await fs.writeFile(
    resultPath,
    JSON.stringify(
      {
        jobId: payload.jobId,
        provider: "open-model-adapter",
        status: "completed",
        completedAt: new Date().toISOString(),
        processedVideoUrl: runtimeAssetUrl("generated", outputFilename),
        shotPlan: payload.shots,
      },
      null,
      2,
    ),
    "utf8",
  );

  await updateStatus(statusPath, {
    jobId: payload.jobId,
    provider: "open-model-adapter",
    status: "completed",
    stage: "Local motion runner finished the cinematic movie",
    progress: 100,
  });
}

main().catch(async (error) => {
  const [, , statusPath] = process.argv;
  if (statusPath) {
    await updateStatus(statusPath, {
      jobId: "unknown",
      provider: "open-model-adapter",
      status: "failed",
      stage: "Local motion runner failed",
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
