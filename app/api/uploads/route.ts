import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/user";

export const runtime = "nodejs";

const MAX_SOURCE_VIDEO_BYTES = 50_000_000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) {
          throw new Error("Sign in before uploading a movie clip.");
        }

        const expectedPrefix = `pulsereel/source/${user.id}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("This upload path does not belong to the signed-in account.");
        }

        return {
          allowedContentTypes: ["video/*"],
          maximumSizeInBytes: MAX_SOURCE_VIDEO_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The clip upload could not be authorized." },
      { status: 400 },
    );
  }
}
