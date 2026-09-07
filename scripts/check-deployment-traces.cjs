// Run after next build. Detect runtime data accidentally packaged as dependencies.
const fs = require("node:fs");
const path = require("node:path");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(name) : [name];
  });
}

const traces = walk(".next/server").filter((name) => name.endsWith(".nft.json"));
if (!traces.length) throw new Error("No traces found. Run npm run build first.");
let violations = 0;
for (const trace of traces) {
  const files = JSON.parse(fs.readFileSync(trace, "utf8")).files;
  const unwanted = files.filter((file) =>
    /(?:public\/(?:uploads|generated)\/|data\/heavy-jobs\/|workers\/|tools\/|\.codex-pulsereel-rollback)/.test(file.replaceAll("\\", "/")),
  );
  if (trace.replaceAll("\\", "/").includes("api/webhooks/replicate/")) {
    unwanted.push(...files.filter((file) => /ffmpeg-static|fluent-ffmpeg|background-removal-node/.test(file)));
  }
  if (unwanted.length) {
    violations += unwanted.length;
    console.error(`${trace}: ${unwanted.length} unwanted dependencies`, unwanted.slice(0, 5));
  }
}
if (violations) process.exitCode = 1;
else console.log(`Checked ${traces.length} traces: no runtime data or local worker files bundled; Replicate webhook has no local renderer dependencies.`);
