import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { Layout, Navbar, Footer, ThemeSwitch } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
});

const basePath = process.env.BASE_PATH || "";

export const metadata: Metadata = {
  title: { default: "Agentron", template: "%s – Agentron" },
  description:
    "Agentron by Julian M. Kleber. Local AI agent orchestration and workflow automation. Self-hosted, privacy-first multi-agent design and execution.",
  icons: {
    icon: [
      { url: `${basePath}/favicon.ico`, sizes: "any" },
      { url: `${basePath}/icon-32.png`, sizes: "32x32", type: "image/png" },
    ],
    apple: `${basePath}/apple-touch-icon.png`,
  },
  keywords: [
    "Agentron",
    "Julian M. Kleber",
    "Julian Kleber",
    "local AI",
    "agent orchestration",
    "workflow automation",
    "multi-agent",
    "self-hosted AI",
  ],
  authors: [{ name: "Julian M. Kleber", url: "https://github.com/cap-jmk-real" }],
  creator: "Julian M. Kleber",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();
  const logoSrc = `${basePath || ""}/img/logo.svg`;
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
    >
      <body data-base-path={basePath}>
        <Layout
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/cap-jmk-real/agentron/tree/main/apps/docs"
          navbar={
            <Navbar
              className="agentron-navbar"
              logoLink={basePath || "/"}
              logo={
                <span className="flex items-center gap-2 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoSrc} alt="" width={32} height={32} className="h-8 w-8" />
                  <span className="font-semibold text-lg whitespace-nowrap">Agentron</span>
                </span>
              }
              projectLink="https://github.com/cap-jmk-real/agentron"
            >
              <ThemeSwitch />
            </Navbar>
          }
          footer={
            <Footer>
              © {new Date().getFullYear()} Agentron by Julian M. Kleber. Local-first AI
              orchestration.
            </Footer>
          }
          sidebar={{ defaultOpen: true, toggleButton: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
