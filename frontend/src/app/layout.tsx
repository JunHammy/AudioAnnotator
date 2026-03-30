import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import EmotionRegistry from "@/lib/emotion-registry";

export const metadata: Metadata = {
  title: "AudioAnnotator",
  description: "Audio annotation platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <EmotionRegistry>
          <Providers>{children}</Providers>
        </EmotionRegistry>
      </body>
    </html>
  );
}
