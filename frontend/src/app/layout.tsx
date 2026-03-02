import type { Metadata } from "next";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "AudioAnnotator",
  description: "Audio annotation platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
