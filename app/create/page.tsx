import Link from "next/link";
import { CreateStudio } from "@/components/create-studio";

export default function CreatePage() {
  return (
    <main className="studio-shell shell">
      <div className="topbar">
        <Link className="button-secondary" href="/">
          Back Home
        </Link>
        <strong>PulseReel Studio</strong>
      </div>
      <CreateStudio />
    </main>
  );
}

