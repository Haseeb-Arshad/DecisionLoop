import { execFileSync } from "node:child_process";

/** Minimal, read-only git helpers. Never mutates the repository. */

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** `owner/name` from the origin remote (GitHub-style URLs), or null. */
export function repositoryName(cwd = process.cwd()): string | null {
  const url = git(["remote", "get-url", "origin"], cwd);
  if (!url) return null;
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/** Files changed relative to `base` (default HEAD), including untracked files. */
export function changedFiles(cwd = process.cwd(), base = "HEAD"): string[] {
  const tracked = git(["diff", "--name-only", base], cwd)?.split(/\r?\n/) ?? [];
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd)?.split(/\r?\n/) ?? [];
  return Array.from(new Set([...tracked, ...untracked].map((f) => f.trim()).filter(Boolean)));
}

export function fileAtRevision(path: string, rev = "HEAD", cwd = process.cwd()): string | null {
  return git(["show", `${rev}:${path}`], cwd);
}
