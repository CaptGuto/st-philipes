import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Ethiopic, Noto_Serif_Ethiopic } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-sans",
});

const ethiopicSans = Noto_Sans_Ethiopic({
  subsets: ["ethiopic"],
  weight: ["400", "700"],
  variable: "--font-ethiopic-sans",
});

const ethiopicSerif = Noto_Serif_Ethiopic({
  subsets: ["ethiopic"],
  weight: ["600", "700"],
  variable: "--font-ethiopic-serif",
});

export const metadata: Metadata = {
  title: "ቅዱስ ፊልጶስ",
  description: "A static site for St. Philipos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${ethiopicSans.variable} ${ethiopicSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
