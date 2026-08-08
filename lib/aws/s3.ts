import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION is not set. See .env.example.");
  }
  // Falls back to the default AWS credential provider chain (env vars,
  // shared config, instance/task role) when AWS_ACCESS_KEY_ID isn't set
  // explicitly — the right behavior once this runs on an IAM role in
  // Amplify/App Runner instead of local dev keys.
  client = new S3Client({ region });
  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error("S3_BUCKET_NAME is not set. See .env.example.");
  }
  return bucket;
}

/** `tenants/<tenantId>/documents/<uuid>-<safeFilename>` — never trust a client-supplied key. */
export function buildDocumentKey(tenantId: string, filename: string): string {
  const safeName = filename
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-120); // keep it bounded; S3 keys can be long but there's no reason to.
  return `tenants/${tenantId}/documents/${crypto.randomUUID()}-${safeName}`;
}

/**
 * Presigned PUT — the browser uploads directly to S3, the file never
 * transits the Next.js server. See docs/architecture.md §3.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

/** Server-side fetch of the object body — used for text extraction right after upload. */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  const response = await getClient().send(command);
  const body = response.Body;
  if (!body) throw new Error(`S3 object ${key} has no body`);
  const chunks: Uint8Array[] = [];
  // @ts-expect-error - Body is a Node.js Readable in the AWS SDK v3 Node runtime.
  for await (const chunk of body) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}
