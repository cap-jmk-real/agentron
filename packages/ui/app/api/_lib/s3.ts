import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export type DocumentStoreRow = {
  id: string;
  type: string;
  bucket: string;
  region: string | null;
  endpoint: string | null;
  credentialsRef: string | null;
};

/**
 * Resolve credentials from ref. Returns { accessKeyId, secretAccessKey } or undefined.
 * - credentialsRef can be: (1) a single env var name with value "accessKey:secretKey",
 *   (2) two env var names comma-separated "ACCESS_KEY_ENV,SECRET_KEY_ENV",
 *   or (3) empty and we use AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */
function resolveCredentials(
  credentialsRef: string | null
): { accessKeyId: string; secretAccessKey: string } | undefined {
  if (credentialsRef?.includes(",")) {
    const [accessRef, secretRef] = credentialsRef.split(",").map((s) => s.trim());
    const accessKey = accessRef ? process.env[accessRef] : undefined;
    const secretKey = secretRef ? process.env[secretRef] : undefined;
    if (accessKey && secretKey) return { accessKeyId: accessKey, secretAccessKey: secretKey };
    return undefined;
  }
  if (credentialsRef && process.env[credentialsRef]) {
    const val = process.env[credentialsRef];
    if (val?.includes(":")) {
      const idx = val.indexOf(":");
      const id = val.slice(0, idx);
      const secret = val.slice(idx + 1);
      if (id && secret) return { accessKeyId: id, secretAccessKey: secret };
    }
    return { accessKeyId: val, secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "" };
  }
  const accessKey = process.env["AWS_ACCESS_KEY_ID"];
  const secretKey = process.env["AWS_SECRET_ACCESS_KEY"];
  if (accessKey && secretKey) return { accessKeyId: accessKey, secretAccessKey: secretKey };
  return undefined;
}

/**
 * Create an S3 client for the given document store (S3 or MinIO).
 */
export function createS3Client(store: DocumentStoreRow): S3Client {
  const creds = resolveCredentials(store.credentialsRef);
  const isMinio = store.type === "minio" && store.endpoint;
  const endpoint = store.endpoint || undefined;
  const region = store.region || "us-east-1";
  const forcePathStyle = isMinio;
  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(forcePathStyle ? { forcePathStyle: true } : {}),
    ...(creds ? { credentials: creds } : {}),
  });
}

/**
 * Upload a buffer to the store's bucket at the given key.
 */
export async function putObject(
  store: DocumentStoreRow,
  key: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  const client = createS3Client(store);
  await client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );
}

/**
 * Download an object from the store's bucket. Returns the body as a buffer.
 */
export async function getObject(store: DocumentStoreRow, key: string): Promise<Buffer> {
  const client = createS3Client(store);
  const res = await client.send(
    new GetObjectCommand({
      Bucket: store.bucket,
      Key: key,
    })
  );
  const stream = res.Body;
  if (!stream) throw new Error("Empty response body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
