import type { MDXComponents } from "nextra/mdx-components";
import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";
import { Callout, Steps, Tabs } from "nextra/components";
import { DownloadLinks } from "./components/DownloadLinks";
import { FeatureMatrix } from "./components/FeatureMatrix";
import { HeapViewer } from "./components/HeapViewer";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  const themeComponents = getThemeComponents(components);
  return {
    ...themeComponents,
    Callout,
    Steps,
    Tabs,
    DownloadLinks,
    FeatureMatrix,
    HeapViewer,
    ...components,
  };
}
