import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulseReel",
  description:
    "Identity-first movie maker for short vertical stories, built from guided templates and your own footage.",
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

