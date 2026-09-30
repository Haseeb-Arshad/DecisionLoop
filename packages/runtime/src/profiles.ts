import fs from "node:fs";
import path from "node:path";
import { BUILTIN_PACKS } from "@decisionloop/core/domain-packs/builtin";
import { DomainRegistry, type DomainPack } from "@decisionloop/core/domain-packs/pack";
import { packFromProfile, parseProfile } from "@decisionloop/core/domain-packs/profile";

/**
 * Builds the domain registry for a process: the built-in domains plus every
 * `*.json` profile in `DECISIONLOOP_PROFILES_DIR` (default
 * `./.decisionloop/profiles`). A profile with a built-in's id replaces it.
 * `DECISIONLOOP_PRIMARY_DOMAIN` picks the domain agents are addressed in.
 *
 * A malformed profile stops startup with the file name and the exact problem:
 * half-loading a domain would quietly change what agents are told.
 */
export function profilesDir(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  return env.DECISIONLOOP_PROFILES_DIR?.trim() || path.join(cwd, ".decisionloop", "profiles");
}

export function loadProfilePacks(dir: string): DomainPack[] {
  if (!fs.existsSync(dir)) return [];
  const packs: DomainPack[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const full = path.join(dir, file);
    try {
      packs.push(packFromProfile(parseProfile(JSON.parse(fs.readFileSync(full, "utf8")))));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Domain profile ${full} is invalid: ${detail}`);
    }
  }
  return packs;
}

export function loadDomainRegistry(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): DomainRegistry {
  const loaded = loadProfilePacks(profilesDir(env, cwd));
  const replaced = new Set(loaded.map((p) => p.id));
  const packs = [...BUILTIN_PACKS.filter((p) => !replaced.has(p.id)), ...loaded];
  const primary = env.DECISIONLOOP_PRIMARY_DOMAIN?.trim() || undefined;
  if (primary && !packs.some((p) => p.id === primary)) {
    throw new Error(`DECISIONLOOP_PRIMARY_DOMAIN is "${primary}", but no such domain is loaded (have: ${packs.map((p) => p.id).join(", ")}).`);
  }
  return new DomainRegistry(packs, primary);
}
