import type { Metadata, Viewport } from "next";
import { Barlow, Big_Shoulders, Big_Shoulders_Stencil, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const shoulders = Big_Shoulders({ subsets: ["latin"], variable: "--font-shoulders", axes: ["opsz"] });
const stencil = Big_Shoulders_Stencil({ subsets: ["latin"], variable: "--font-stencil-face", axes: ["opsz"] });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "QueueUp: tickets that never oversell", template: "%s · QueueUp" },
  description:
    "Sell a fixed number of tickets, hold seats while people pay, and check them in at the door by QR. A hundred people can race for the last seat; exactly one gets it.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f4a35" };

// Direction contract, emitted into the built markup so the finish review can audit it.
const CONTRACT = `<!--
THESIS: QueueUp is a ballpark scoreboard, live and counted and never wrong. It refuses the SaaS headline-plus-screenshot hero.
OWN-WORLD: Scoreboard-green painted steel fields, enamel-white numeral plates, amber incandescent bulbs, out-red dashed outlines. Big Shoulders stencil caps, Barlow text. Flat paint, zero shadows or gradients, state as illumination, one slot-grid module.
STORY: Visitors read the offer, see the platform's real totals on the board, learn the four steps, see who it's for and real events on sale, then host or find an event. The 100-buyer race lives on /about.
FIRST VIEWPORT: Full-width green board. Stencil headline "Run the door like a ballpark." with copy and two equal plate buttons, HOST AN EVENT and FIND AN EVENT. Below, a full-width board of three enamel numeral plates (tickets sold, checked in, events on sale) from GET /stats, flipping into place and refreshing every 10s.
FORM: The Ballpark Scoreboard, candidate 4 of 7, seed 9b51bade.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${shoulders.variable} ${stencil.variable} ${barlow.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <div hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
