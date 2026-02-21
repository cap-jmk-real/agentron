"use client";

import type { ReactElement } from "react";
import { useMDXComponents } from "nextra-theme-docs";

type TocItem = { value: string | ReactElement; id: string; depth: number };

type PageWrapperProps = {
  toc: TocItem[];
  metadata: { filePath?: string; title?: string; searchable?: boolean };
  sourceCode?: string;
  children: React.ReactNode;
};

export function PageWrapper({ toc = [], metadata, sourceCode, children }: PageWrapperProps) {
  const components = useMDXComponents({});
  const Wrapper = components.wrapper as React.ComponentType<{
    toc: TocItem[];
    metadata: PageWrapperProps["metadata"];
    sourceCode?: string;
    children: React.ReactNode;
  }>;
  if (!Wrapper) return <>{children}</>;
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      {children}
    </Wrapper>
  );
}
