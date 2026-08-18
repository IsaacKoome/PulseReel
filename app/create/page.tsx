import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account-nav";
import { CreateStudio } from "@/components/create-studio";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const authEnabled = isAuthEnabled();
  const user = await getCurrentUser();

  if (authEnabled && !user) {
    redirect("/login?next=/create");
  }

  return (
    <main className="studio-shell shell">
      <div className="app-header compact-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <div className="header-actions">
          <AccountNav enabled={authEnabled} user={user} compact />
          <Link className="button-secondary" href="/">
            Home
          </Link>
        </div>
      </div>
      <CreateStudio />
    </main>
  );
}
