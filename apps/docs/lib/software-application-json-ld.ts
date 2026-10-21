const SITE_URL = "https://docs.agentron.rocks";
const RELEASES_URL = "https://github.com/cap-jmk-real/agentron/releases";

/** Matches root / desktop package version at release time (see `npm run release:bump`). */
export const AGENTRON_SOFTWARE_VERSION = "0.1.9";

export type SoftwareApplicationJsonLd = {
  "@context": "https://schema.org";
  "@type": "SoftwareApplication";
  name: string;
  alternateName: string;
  applicationCategory: string;
  operatingSystem: string;
  description: string;
  url: string;
  downloadUrl: string;
  softwareVersion: string;
  license: string;
  image: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
    url: string;
  };
  author: {
    "@type": "Person";
    name: string;
    url: string;
  };
};

export function buildSoftwareApplicationJsonLd(basePath = ""): SoftwareApplicationJsonLd {
  const prefix = basePath.replace(/\/+$/, "");
  const imagePath = `${prefix}/apple-touch-icon.png`;

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Agentron",
    alternateName: "Agentron Studio",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows, macOS, Linux",
    description:
      "Local-first AI agent orchestration and workflow automation. Design multi-agent workflows, chat assistants, RAG, and heap specialists on your own infrastructure.",
    url: SITE_URL,
    downloadUrl: RELEASES_URL,
    softwareVersion: AGENTRON_SOFTWARE_VERSION,
    license: "https://opensource.org/licenses/MIT",
    image: imagePath.startsWith("http") ? imagePath : `${SITE_URL}${imagePath}`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      url: RELEASES_URL,
    },
    author: {
      "@type": "Person",
      name: "Julian M. Kleber",
      url: "https://github.com/cap-jmk-real",
    },
  };
}
