import { promises as fs } from "fs";
import path from "path";

async function main() {
  const [payloadPath, resultPath, statusPath] = process.argv.slice(2);

  if (!payloadPath || !resultPath || !statusPath) {
    throw new Error("Usage: node scripts/open-model-adapter.mjs <payloadPath> <resultPath> <statusPath>");
  }

  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  await fs.mkdir(path.dirname(resultPath), { recursive: true });

  await fs.writeFile(
    statusPath,
    JSON.stringify(
      {
        jobId: payload.jobId,
        provider: "open-model-adapter",
        status: "running",
        stage: "Sample open-model adapter received the payload bundle",
        progress: 18,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    resultPath,
    JSON.stringify(
      {
        jobId: payload.jobId,
        provider: "open-model-adapter",
        status: "failed",
        completedAt: new Date().toISOString(),
        error:
          "Sample open-model adapter ran successfully, but no external motion model is connected yet. The main worker should fall back to the local heavy renderer.",
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write(
    `PulseReel sample adapter received ${payload.shots.length} shots and ${payload.shotReferences.length} reference assets for ${payload.story.title}. Configure PULSEREEL_OPEN_MODEL_RUNNER to point at a real backend command to replace this placeholder.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
