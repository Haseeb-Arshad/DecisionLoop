import crypto from "node:crypto";
import type { DecisionStore } from "@decisionloop/core/ports/store";
import type { Actor, ApiKeyRecord, Scope } from "@decisionloop/core/types/records";

/**
 * Machine credentials for MCP clients, the SDK, the CLI and agent hooks.
 *
 * Format: `dl_<8-char prefix>_<32 bytes base64url>`. Only the SHA-256 of the
 * whole key is stored; the prefix is kept in clear so a person can tell
 * keys apart in the control plane. A key is shown once, at creation.
 */

const KEY_RE = /^dl_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const prefix = crypto.randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 8);
  const secret = crypto.randomBytes(32).toString("base64url");
  const raw = `dl_${prefix}_${secret}`;
  return { raw, prefix: `dl_${prefix}`, hash: hashApiKey(raw) };
}

export async function issueApiKey(
  store: DecisionStore,
  input: { tenantId: string; name: string; scopes: Scope[]; actorType: ApiKeyRecord["actorType"]; createdBy?: string | null; eventSource?: string | null },
): Promise<{ key: string; record: ApiKeyRecord }> {
  const { raw, prefix, hash } = generateApiKey();
  const record = await store.createApiKey({ ...input, keyPrefix: prefix, keyHash: hash });
  return { key: raw, record };
}

/** Resolves a bearer key to an actor, or null. Malformed keys never reach the database. */
export async function authenticateApiKey(store: DecisionStore, raw: string | null | undefined): Promise<Actor | null> {
  if (!raw || !KEY_RE.test(raw)) return null;
  const record = await store.findApiKeyByHash(hashApiKey(raw));
  if (!record) return null;
  // Best effort: a failed timestamp update must not fail the request.
  store.touchApiKey(record.id).catch(() => undefined);
  return {
    tenantId: record.tenantId,
    type: record.actorType,
    userId: null,
    label: record.name,
    scopes: record.scopes,
    apiKeyId: record.id,
    eventSource: record.eventSource,
    sessionId: `key:${record.id}`,
  };
}
