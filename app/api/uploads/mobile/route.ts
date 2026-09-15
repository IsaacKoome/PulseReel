import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/auth/request-user";

export const runtime = "nodejs";

const MAX_SOURCE_VIDEO_BYTES = 50_000_000;
const requestSchema = z.object({
  pathname: z.string().min(1).max(512),
  contentType: z.string().regex(/^video\/[a-z0-9.+-]+$/i),
  size: z.number().int().positive().max(MAX_SOURCE_VIDEO_BYTES),
});

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Sign in before uploading a movie clip." }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Choose a video no larger than 50 MB." },
        { status: 400 },
      );
    }

    const { pathname, contentType, size } = parsed.data;
    const expectedPrefix = `pulsereel/source/${user.id}/`;
    const uploadName = pathname.slice(expectedPrefix.length);
    if (!pathname.startsWith(expectedPrefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(uploadName)) {
      return NextResponse.json(
        { error: "This upload path does not belong to the signed-in account." },
        { status: 403 },
      );
    }

    const validUntil = Date.now() + 15 * 60_000;
    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: size,
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      access: "public",
      operation: "put",
      pathname,
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: size,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
    });

    return NextResponse.json({ uploadUrl: presignedUrl });
  } catch (error) {
    console.error("PulseReel mobile upload authorization failed.", error);
    return NextResponse.json(
      { error: "The clip upload could not be authorized." },
      { status: 503 },
    );
  }
}
