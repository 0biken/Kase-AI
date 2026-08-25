import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
    
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
      })
    );

    return {
      uri: `s3://${this.bucket}/${key}`,
      sha256: hash,
    };
  }
}
