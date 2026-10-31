import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "TerraMind AI · Earth Investigator",
  description: "Investigate historical changes measured from real satellite observations.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body style={{ margin: 0, background: "#0b1413", color: "#e5efeb", fontFamily: "system-ui, sans-serif" }}>{children}</body></html>;
}
