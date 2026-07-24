import Link from "next/link";
import { CreateStudio } from "@/components/create-studio";
import { getEffectiveCreatorBetaConfig } from "@/lib/creator-beta";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const creatorBeta = await getEffectiveCreatorBetaConfig();

  return (
    <main className="studio-shell shell">
      <div className="app-header compact-header">
        <Link className="brand-mark" href="/">
          PulseReel
        </Link>
        <Link className="button-secondary" href="/">
          Home
        </Link>
      </div>
      <CreateStudio creatorBeta={creatorBeta} />
    </main>
  );
}
