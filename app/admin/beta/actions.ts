"use server";

import { revalidatePath } from "next/cache";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { setBetaGenerationEnabled } from "@/lib/generation-access";

export async function setGenerationEnabled(formData: FormData) {
  const user = await getCurrentUser();
  if (!isPulseReelAdmin(user)) {
    throw new Error("You are not allowed to change PulseReel beta controls.");
  }

  await setBetaGenerationEnabled(formData.get("enabled") === "true");
  revalidatePath("/admin/beta");
  revalidatePath("/create");
}
