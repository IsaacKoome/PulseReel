import path from "path";

export type RuntimeAssetFolder = "uploads" | "generated";

export function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function getRuntimeRoot() {
  return isVercelRuntime() ? path.join("/tmp", "pulsereel") : process.cwd();
}

export function getRuntimeDataDir() {
  return path.join(getRuntimeRoot(), "data");
}

export function getRuntimeAssetDir(folder: RuntimeAssetFolder, ...parts: string[]) {
  const base = isVercelRuntime()
    ? path.join(getRuntimeRoot(), "public", folder)
    : path.join(process.cwd(), "public", folder);
  return path.join(base, ...parts);
}

export function runtimeAssetUrl(folder: RuntimeAssetFolder, filename: string) {
  return `/api/assets/${folder}/${filename}`;
}

export function assetUrlToPath(url?: string) {
  if (!url) {
    return undefined;
  }

  const normalized = url.replace(/^\//, "");
  const assetMatch = normalized.match(/^api\/assets\/(uploads|generated)\/(.+)$/);
  if (assetMatch) {
    return getRuntimeAssetDir(assetMatch[1] as RuntimeAssetFolder, assetMatch[2]);
  }

  const publicMatch = normalized.match(/^(uploads|generated)\/(.+)$/);
  if (publicMatch) {
    return getRuntimeAssetDir(publicMatch[1] as RuntimeAssetFolder, publicMatch[2]);
  }

  return path.join(process.cwd(), "public", normalized);
}
