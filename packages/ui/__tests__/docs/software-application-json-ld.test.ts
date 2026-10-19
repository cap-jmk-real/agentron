import { describe, expect, it } from "vitest";
import { buildSoftwareApplicationJsonLd } from "../../../../apps/docs/lib/software-application-json-ld";

describe("buildSoftwareApplicationJsonLd", () => {
  it("returns SoftwareApplication schema with download and version fields", () => {
    const jsonLd = buildSoftwareApplicationJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("SoftwareApplication");
    expect(jsonLd.name).toBe("Agentron");
    expect(jsonLd.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(jsonLd.downloadUrl).toContain("github.com/cap-jmk-real/agentron/releases");
    expect(jsonLd.offers.price).toBe("0");
    expect(jsonLd.image).toBe("https://docs.agentron.rocks/apple-touch-icon.png");
  });

  it("prefixes image URL when BASE_PATH is set", () => {
    const jsonLd = buildSoftwareApplicationJsonLd("/docs");
    expect(jsonLd.image).toBe("https://docs.agentron.rocks/docs/apple-touch-icon.png");
  });
});
