"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { syncGenerationReservationForProject } from "@/lib/generation-access";
import { verifyLivePayment } from "@/lib/paystack-live";
import { reconcileDirectReplicateProject } from "@/lib/replicate-direct";
import { getProjectById } from "@/lib/store";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!isPulseReelAdmin(user)) throw new Error("Admin access required.");
}

function billingRedirect(message: string) {
  revalidatePath("/admin/billing");
  revalidatePath("/billing");
  redirect(`/admin/billing?notice=${encodeURIComponent(message)}`);
}

export async function recheckPaidOrder(formData: FormData) {
  await requireAdmin();
  const reference = String(formData.get("reference") ?? "");
  let message: string;
  try {
    await verifyLivePayment(reference);
    message = "Payment verified and attempts reconciled.";
  } catch (error) {
    message = error instanceof Error ? error.message : "Payment could not be rechecked.";
  }
  billingRedirect(message);
}

export async function reconcilePaidGeneration(formData: FormData) {
  await requireAdmin();
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) billingRedirect("This attempt has no project to reconcile.");

  let message: string;
  try {
    const project = await getProjectById(projectId);
    if (!project) throw new Error("The linked project could not be found.");
    if (project.status === "published" || project.status === "failed") {
      await syncGenerationReservationForProject(
        project.id,
        project.status === "published" ? "completed" : "failed",
      );
    } else if (project.workerJob?.executionMode === "direct-replicate" && project.workerJob.remoteJobId) {
      await reconcileDirectReplicateProject(project);
    } else {
      throw new Error("The provider has not supplied a final state yet; the attempt remains reserved.");
    }
    message = "Generation state reconciled from the linked project.";
  } catch (error) {
    message = error instanceof Error ? error.message : "Generation could not be reconciled.";
  }
  billingRedirect(message);
}
