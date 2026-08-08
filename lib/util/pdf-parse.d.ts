// pdf-parse ships no official TypeScript types. Minimal shape for what we use.
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export = pdfParse;
}
