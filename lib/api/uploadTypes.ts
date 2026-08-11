import type { DocumentSourceType } from "@/lib/types";

/**
 * Shared shape for an upload initiated from the UI. Lives in its own module
 * because both the mutation hook (lib/queries.ts) and the upload components
 * need it, and neither should import the other.
 */
export interface DecisionSourceUpload {
  file: File;
  projectId?: string;
  sourceType?: DocumentSourceType;
}

export const SOURCE_TYPE_OPTIONS: Array<{
  value: DocumentSourceType;
  label: string;
  hint: string;
}> = [
  {
    value: "CONTRACT",
    label: "Signed contract",
    hint: "Highest authority — can invalidate an assumption on its own.",
  },
  {
    value: "VENDOR_OFFICIAL",
    label: "Vendor official document",
    hint: "Pricing sheets, renewal notices, published SLAs.",
  },
  {
    value: "INTERNAL_ANALYSIS",
    label: "Internal analysis",
    hint: "Your team's own review or benchmark.",
  },
  { value: "NEWS", label: "News / third-party report", hint: "Lower authority; flags for review." },
  {
    value: "UNVERIFIED",
    label: "Unverified",
    hint: "Lowest authority — will challenge, never invalidate.",
  },
  { value: "OTHER", label: "Other", hint: "Default authority." },
];
