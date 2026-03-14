import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Tracker - NH Snowmobile trails",
  description: "NH Snowmobile trail tracker with GPX and elevation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0 min-h-full p-0 bg-slate-950 text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
