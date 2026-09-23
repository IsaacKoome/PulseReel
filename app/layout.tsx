import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MimiReel",
  description:
    "MimiReel turns your short clip and scene idea into an identity-first movie.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

