import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true,
    });
    this.bucket = process.env.S3_BUCKET || 'kase-evidence';
  }

  /**
   * Uploads evidence to a content-addressed path
   * s3://bucket/<projectId>/<auditId>/<sha256>
   */
  async uploadEvidence(projectId: string, auditId: string, content: Buffer): Promise<{ uri: string; sha256: string }> {
    const hash = createHash('sha256').update(content).digest('hex');
    const key = `${projectId}/${auditId}/${hash}`;
    
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentLength: content.length,
        Metadata: { sha256: hash },
        IfNoneMatch: '*',
      }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
    }

    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!head.ContentLength || head.ContentLength !== content.length || head.Metadata?.sha256 !== hash) {
      throw new Error('Stored evidence failed size or digest metadata verification');
    }

    return {
      uri: `s3://${this.bucket}/${key}`,
      sha256: hash,
    };
  }

  async verifyEvidence(uri: string, expectedSha256: string, expectedSize: number): Promise<void> {
    const key = this.keyFromUri(uri);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = Buffer.from(await response.Body!.transformToByteArray());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length <= 0 || bytes.length !== expectedSize || actual !== expectedSha256) {
      throw new Error('Stored evidence failed independent verification');
    }
  }

  async downloadEvidence(uri: string): Promise<Buffer> {
    const key = this.keyFromUri(uri);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  private keyFromUri(uri: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!uri.startsWith(prefix)) throw new Error('Evidence URI does not belong to configured bucket');
    return uri.slice(prefix.length);
  }
}
