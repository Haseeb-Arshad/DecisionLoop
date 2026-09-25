import { SignJWT, importPKCS8 } from "jose";

/**
 * Minimal GitHub REST client for what the integration needs: PR files, file
 * contents at a ref, and one upserted advisory comment per PR.
 *
 * Auth: a GitHub App (preferred; per-installation tokens with minimum
 * scopes — pull requests: read, contents: read, issues: write) or, for local
 * development only, a personal access token.
 */

export interface GithubAuth {
  token(installationId: string | null): Promise<string>;
}

export function patAuth(token: string): GithubAuth {
  return { token: async () => token };
}

export function appAuth(appId: string, privateKeyPem: string, apiUrl = "https://api.github.com", fetchImpl: typeof fetch = fetch): GithubAuth {
  const cache = new Map<string, { token: string; expires: number }>();
  return {
    async token(installationId) {
      if (!installationId) throw new Error("GitHub App auth needs an installation id (bind the repository with its installation).");
      const hit = cache.get(installationId);
      if (hit && hit.expires - Date.now() > 60_000) return hit.token;
      const key = await importPKCS8(privateKeyPem.replace(/\\n/g, "\n"), "RS256");
      const now = Math.floor(Date.now() / 1000);
      const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(appId).setIssuedAt(now - 30).setExpirationTime(now + 540).sign(key);
      const res = await fetchImpl(`${apiUrl}/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      });
      if (!res.ok) throw new Error(`GitHub installation token request failed: ${res.status}`);
      const body = (await res.json()) as { token: string; expires_at: string };
      cache.set(installationId, { token: body.token, expires: Date.parse(body.expires_at) });
      return body.token;
    },
  };
}

export class GithubClient {
  constructor(
    private readonly auth: GithubAuth,
    private readonly apiUrl = "https://api.github.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(installationId: string | null, method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.auth.token(installationId)}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null as T;
    if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }

  async listPullRequestFiles(installationId: string | null, repo: string, number: number) {
    const files: Array<{ filename: string; status: string; previous_filename?: string }> = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.call<typeof files>(installationId, "GET", `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
      if (!batch?.length) break;
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files;
  }

  async fileAt(installationId: string | null, repo: string, path: string, ref: string): Promise<string | null> {
    const r = await this.call<{ content?: string; encoding?: string } | null>(
      installationId,
      "GET",
      `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (!r?.content) return null;
    return Buffer.from(r.content, (r.encoding as BufferEncoding) ?? "base64").toString("utf8");
  }

  /** Creates the advisory comment, or edits the existing one (identified by a hidden marker). */
  async upsertComment(installationId: string | null, repo: string, number: number, marker: string, body: string) {
    const comments = await this.call<Array<{ id: number; body?: string }>>(installationId, "GET", `/repos/${repo}/issues/${number}/comments?per_page=100`);
    const mine = comments?.find((c) => c.body?.includes(marker));
    if (mine) return this.call(installationId, "PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body });
    return this.call(installationId, "POST", `/repos/${repo}/issues/${number}/comments`, { body });
  }
}
