import { EvidenceCaptureService } from '../../evidence/evidence-capture.service';

export interface ProxyHttpRequest {
  method: string; url: string; proxyUrl: string; headers?: Record<string, string>;
  body?: Buffer; signal?: AbortSignal; auditKey: string; secrets?: readonly string[];
}
export interface ProxyHttpResponse { status: number; headers: Record<string, string>; body: Buffer }
export type ProxyExecutor = (request: Omit<ProxyHttpRequest, 'auditKey' | 'secrets'>) => Promise<ProxyHttpResponse>;

export class ProxyHttpAdapter {
  constructor(private readonly execute: ProxyExecutor, private readonly capture = new EvidenceCaptureService()) {}

  async run(input: ProxyHttpRequest) {
    if (!/^https?:\/\//iu.test(input.proxyUrl)) throw new Error('A valid egress proxy is required; direct target access is forbidden');
    const response = await this.execute({ method: input.method, url: input.url, proxyUrl: input.proxyUrl, headers: input.headers, body: input.body, signal: input.signal });
    const exchange = JSON.stringify({
      request: { method: input.method.toUpperCase(), url: input.url, headers: input.headers ?? {}, body: input.body?.toString('utf8') },
      response: { status: response.status, headers: response.headers, body: response.body.toString('utf8') },
    });
    const captured = this.capture.capture(input.auditKey, exchange, { registeredSecrets: input.secrets });
    return { type: 'http_exchange' as const, replayable: true, content: captured.bytes,
      metadata: { method: input.method.toUpperCase(), url: input.url, status: response.status }, ...captured };
  }
}
