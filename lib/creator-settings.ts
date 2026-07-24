import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { z } from "zod";
import { getRuntimeDataDir, isVercelRuntime } from "@/lib/runtime-storage";

export type CreatorLaunchMode = "creator-beta" | "original-mvp";

export type CreatorRuntimeSettings = {
  launchMode: CreatorLaunchMode;
  managedDailyLimit: number;
  updatedAt: string;
};

const settingsSchema = z.object({
  launchMode: z.enum(["creator-beta", "original-mvp"]),
  managedDailyLimit: z.number().int().min(1).max(50),
  updatedAt: z.string(),
});

const settingsFile = path.join(getRuntimeDataDir(), "creator-settings.json");
const settingsBlobKey = "pulsereel/creator-settings.json";

function defaultManagedDailyLimit() {
  const configured = Number.parseInt(process.env.PULSEREEL_MANAGED_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 50) : 3;
}

function defaults(): CreatorRuntimeSettings {
  return {
    launchMode: "creator-beta",
    managedDailyLimit: defaultManagedDailyLimit(),
    updatedAt: new Date(0).toISOString(),
  };
}

function canUseBlobStore() {
  return isVercelRuntime() && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function getCreatorRuntimeSettings(): Promise<CreatorRuntimeSettings> {
  if (canUseBlobStore()) {
    for (const access of ["private", "public"] as const) {
      try {
        const result = await get(settingsBlobKey, {
          access,
          ...(access === "private" ? { useCache: false } : {}),
        });
        if (!result?.stream) continue;
        const parsed = settingsSchema.safeParse(await new Response(result.stream).json());
        if (parsed.success) return parsed.data;
      } catch {
        // Try the alternate Blob access mode, then fall back to local/default settings.
      }
    }
  }

  try {
    const parsed = settingsSchema.safeParse(JSON.parse(await fs.readFile(settingsFile, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // A missing local settings file means the safe Creator Beta default is active.
  }

  return defaults();
}

export async function saveCreatorRuntimeSettings(input: {
  launchMode: CreatorLaunchMode;
  managedDailyLimit: number;
}) {
  const settings = settingsSchema.parse({
    ...input,
    updatedAt: new Date().toISOString(),
  });

  if (canUseBlobStore()) {
    for (const access of ["private", "public"] as const) {
      try {
        await put(settingsBlobKey, JSON.stringify(settings, null, 2), {
          access,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json",
        });
        return settings;
      } catch {
        // Try the alternate Blob access mode before falling back to local storage.
      }
    }
  }

  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}
