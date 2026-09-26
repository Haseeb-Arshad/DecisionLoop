import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * CLI configuration, most specific wins:
 *   1. environment: DECISIONLOOP_URL, DECISIONLOOP_API_KEY
 *   2. project:     ./.decisionloop/config.json + ./.decisionloop/credentials.json
 *   3. user:        ~/.decisionloop/credentials.json (written by `decisionloop login`)
 *
 * Credentials files are written with owner-only permissions and the project
 * directory is added to .gitignore by `init`. Keys are never printed except
 * once, at creation.
 */

export interface ProjectConfig {
  url: string;
  workspaceId?: string;
  repository?: string | null;
  dataDir?: string;
}

export interface Credentials {
  apiKey?: string;
  agentKey?: string;
  url?: string;
}

export const PROJECT_DIR = ".decisionloop";

export function projectDir(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_DIR);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(file: string, value: unknown, secret = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: secret ? 0o600 : 0o644 });
  if (secret) {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows: ACLs rather than modes; the file lives under the user's profile or project.
    }
  }
}

export function loadConfig(cwd = process.cwd()): { url: string; apiKey: string | null; agentKey: string | null; project: ProjectConfig | null } {
  const project = readJson<ProjectConfig>(path.join(projectDir(cwd), "config.json"));
  const projectCreds = readJson<Credentials>(path.join(projectDir(cwd), "credentials.json"));
  const userCreds = readJson<Credentials>(path.join(os.homedir(), PROJECT_DIR, "credentials.json"));
  return {
    url: process.env.DECISIONLOOP_URL ?? project?.url ?? userCreds?.url ?? "http://127.0.0.1:4318",
    apiKey: process.env.DECISIONLOOP_API_KEY ?? projectCreds?.apiKey ?? userCreds?.apiKey ?? null,
    agentKey: process.env.DECISIONLOOP_AGENT_KEY ?? projectCreds?.agentKey ?? null,
    project,
  };
}

export function ensureGitignored(cwd = process.cwd()): boolean {
  const file = path.join(cwd, ".gitignore");
  const line = `${PROJECT_DIR}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === PROJECT_DIR)) return false;
  fs.writeFileSync(file, `${current}${current.endsWith("\n") || current === "" ? "" : "\n"}${line}\n`);
  return true;
}
