import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class RetentionObjectStoreService {
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        // Deliberately separate from application upload credentials.
        accessKeyId: process.env.S3_RETENTION_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_RETENTION_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true,
    });
  }

  /** S3 DeleteObject is idempotent: an absent key is still a successful delete. */
  async deleteArtifact(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
export function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!uri.startsWith('s3://')) throw new Error('Evidence artifact URI is not an s3 URI');
  const withoutScheme = uri.slice('s3://'.length);
  const separator = withoutScheme.indexOf('/');
  if (separator <= 0 || separator === withoutScheme.length - 1) {
    throw new Error('Evidence artifact URI must contain a bucket and object key');
  }
  return {
    bucket: withoutScheme.slice(0, separator),
    key: withoutScheme.slice(separator + 1),
  };
}
