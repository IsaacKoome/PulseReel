import { get } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

if (!supabaseUrl || !serviceRoleKey || !blobToken) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and BLOB_READ_WRITE_TOKEN are required.",
  );
}

async function readLegacyProjects() {
  for (const access of ["private", "public"]) {
    try {
      const result = await get("pulsereel/projects.json", {
        access,
        token: blobToken,
        ...(access === "private" ? { useCache: false } : {}),
      });
      if (result?.stream) {
        return JSON.parse(await new Response(result.stream).text());
      }
    } catch {
      // Try the other access mode used by earlier PulseReel deployments.
    }
  }
  throw new Error("Could not read the legacy PulseReel project store.");
}

const projects = await readLegacyProjects();
const rows = projects.map((project) => ({
  id: project.id,
  slug: project.slug,
  owner_id: project.ownerId ?? null,
  visibility: project.visibility ?? (project.ownerId ? "unlisted" : "public"),
  status: project.status,
  project: {
    ...project,
    visibility: project.visibility ?? (project.ownerId ? "unlisted" : "public"),
  },
  created_at: project.createdAt,
  updated_at: project.updatedAt,
}));

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

if (rows.length > 0) {
  const { error } = await supabase
    .from("pulse_reel_projects")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    throw new Error(`PulseReel migration failed: ${error.message}`);
  }
}

console.log(`Migrated ${rows.length} PulseReel project records to Supabase.`);
