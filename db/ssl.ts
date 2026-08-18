import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Resolve CockroachDB Cloud's certificate from a secret or standard local path. */
export function getCockroachSslOptions(): { ca: string } | undefined {
  const inlineCa = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
  if (inlineCa) return { ca: inlineCa };

  const candidates = [
    process.env.DATABASE_SSL_ROOT_CERT,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "postgresql", "root.crt")
      : undefined,
    path.join(os.homedir(), ".postgresql", "root.crt"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return { ca: fs.readFileSync(candidate, "utf8") };
      }
    } catch {
      // Try the next conventional location.
    }
  }

  return undefined;
}
