/**
 * Extracts plain text from an uploaded document buffer. Supports PDF and
 * plain text/markdown — the formats the demo scenario actually needs
 * (pricing sheets, notes). Anything else is decoded as UTF-8 best-effort.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string | null,
  filename: string,
): Promise<string> {
  const isPdf =
    mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    // pdf-parse has no official TypeScript types; the default export is a
    // function `(buffer) => Promise<{ text: string, ... }>`.
    const pdfParse = (await import("pdf-parse")).default as (
      data: Buffer,
    ) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    return result.text;
  }

  return buffer.toString("utf-8");
}
