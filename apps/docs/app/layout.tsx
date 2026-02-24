import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Layout, Navbar, Footer } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "Agentron", template: "%s – Agentron" },
  description:
    "Agentron by Julian M. Kleber — local AI agent orchestration and workflow automation. Self-hosted, privacy-first multi-agent design and execution.",
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

const basePath = process.env.BASE_PATH || "";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();
  const logoSrc = `${basePath || ""}/img/logo.svg`;
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={inter.variable}>
      <body data-base-path={basePath}>
        <Layout
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/cap-jmk-real/agentron/tree/main/apps/docs"
          navbar={
            <Navbar
              logoLink={basePath || "/"}
              logo={
                <span className="flex items-center gap-2 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoSrc} alt="" width={32} height={32} className="h-8 w-8" />
                  <span className="font-semibold text-lg whitespace-nowrap">Agentron</span>
                </span>
              }
              projectLink="https://github.com/cap-jmk-real/agentron"
            />
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
