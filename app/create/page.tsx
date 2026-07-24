import Link from "next/link";
import { CreateStudio } from "@/components/create-studio";
import { getCreatorBetaConfig } from "@/lib/creator-beta";

export default function CreatePage() {
  const creatorBeta = getCreatorBetaConfig();

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
