import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account-nav";
import { CreateStudio } from "@/components/create-studio";
import { SiteFooter } from "@/components/site-footer";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { getGenerationAccessStatus } from "@/lib/generation-access";
import { isVercelRuntime } from "@/lib/runtime-storage";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const authEnabled = isAuthEnabled();
  const user = await getCurrentUser();

  if (authEnabled && !user) {
    redirect("/login?next=/create");
  }

  const betaAccess = await getGenerationAccessStatus(user);

  return (
    <main className="studio-shell shell">
      <div className="app-header compact-header">
        <a className="brand-mark" href="/">
          PulseReel
        </a>
        <div className="header-actions">
          <AccountNav enabled={authEnabled} user={user} compact isAdmin={isPulseReelAdmin(user)} />
          <a className="button-secondary" href="/">
            Home
          </a>
        </div>
      </div>
      <CreateStudio
        initialBetaAccess={betaAccess}
        seedance15ExperimentEnabled={isPulseReelAdmin(user)}
        directVideoUploadEnabled={
          isVercelRuntime() && Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
        }
        uploadOwnerId={user?.id}
      />
      <SiteFooter />
    </main>
  );
}
