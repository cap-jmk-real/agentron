import { generateStaticParamsFor, importPage } from "nextra/pages";
import { PageWrapper } from "../page-wrapper";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

export async function generateMetadata(props: { params: Promise<{ mdxPath?: string[] }> }) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  return metadata;
}

export default async function Page(props: {
  params: Promise<{ mdxPath?: string[] }>;
  children?: React.ReactNode;
}) {
  const params = await props.params;
  const result = await importPage(params.mdxPath);
  const { default: MDXContent, toc = [], metadata, sourceCode } = result;
  return (
    <PageWrapper toc={toc} metadata={metadata ?? {}} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </PageWrapper>
  );
}
