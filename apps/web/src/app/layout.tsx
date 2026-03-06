import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Full-Stack Cursor Starter",
  description: "Next.js + PocketBase starter",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
