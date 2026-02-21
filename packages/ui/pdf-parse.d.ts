declare module "pdf-parse" {
  function pdfParse(
    dataBuffer: Buffer,
    options?: unknown
  ): Promise<{ text?: string; numpages?: number; [key: string]: unknown }>;
  export default pdfParse;
}
