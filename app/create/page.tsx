import Link from "next/link";
import { CreateStudio } from "@/components/create-studio";

export default function CreatePage() {
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
      <CreateStudio />
    </main>
  );
}
