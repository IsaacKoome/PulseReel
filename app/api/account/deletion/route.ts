import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/request-user";
import { requestAccountDeletion } from "@/lib/safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in to request account deletion." }, { status: 401 });
  }

  try {
    const result = await requestAccountDeletion(user.id, user.email);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The deletion request could not be submitted." },
      { status: 503 },
    );
  }
}
