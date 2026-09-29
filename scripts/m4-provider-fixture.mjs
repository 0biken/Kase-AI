import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT ?? 4010);

export function responsePlan(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  const results = input.filter(item => item?.type === 'function_call_output');
  const evidenceId = results.map(item => extractEvidenceId(item?.output)).findLast(Boolean);
  if (results.length < 2) return {
    name: 'run_http_probe',
    arguments: {
      testIdentityId: process.env.TEST_IDENTITY_ID ?? 'tid_missing',
      url: process.env.PROBE_URL ?? 'http://fixture:3000/api/invoices/inv_1001',
      method: 'GET', followRedirects: false,
    },
  };
  if (results.length === 2) {
    if (!evidenceId) throw new Error('HTTP tool result did not contain evidence');
    return {
      name: 'create_finding',
      arguments: {
        category: 'authorization', severityProposed: 'high',
        title: 'Invoice can be read by a different authenticated user', cwe: 'CWE-639',
        reproduction: { kind: 'http_replay', evidenceId },
        impact: 'An authenticated user can read another user invoice by supplying its identifier.',
        remediation: 'Constrain invoice lookup by both invoice identifier and authenticated owner identifier.',
        evidenceIds: [evidenceId],
      },
    };
  }
  return { name: 'finish_audit', arguments: { summary: 'Replayed the cross-account invoice request and recorded the evidence-backed authorization finding.' } };
}

export function extractEvidenceId(output) {
  if (typeof output !== 'string') return undefined;
  const match = output.match(/<UNTRUSTED_DATA>\s*([\s\S]*?)\s*<\/UNTRUSTED_DATA>/u);
  try {
    const parsed = JSON.parse(match?.[1] ?? output);
    return parsed?.data?.evidenceIds?.[0];
  } catch { return undefined; }
}

export function sseEvents(plan, sequence) {
  const id = `fixture-response-${sequence}`;
  const callId = `fixture-call-${sequence}`;
  const itemId = `fixture-item-${sequence}`;
  const args = JSON.stringify(plan.arguments);
  return [
    { type: 'response.output_item.added', item: { type: 'function_call', id: itemId, call_id: callId, name: plan.name } },
    { type: 'response.function_call_arguments.delta', item_id: itemId, delta: args },
    { type: 'response.function_call_arguments.done', item_id: itemId, arguments: args },
    { type: 'response.completed', response: { id, output: [{ type: 'function_call' }], usage: { input_tokens: 31, output_tokens: 17, input_tokens_details: { cached_tokens: 0 } } } },
  ];
}

export function createFixtureServer() {
  let sequence = 0;
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end();
      return;
    }
    const authorization = request.headers.authorization ?? '';
    if (authorization !== 'Bearer fixture-only') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":"invalid fixture credential"}');
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const plan = responsePlan(body);
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (const event of sseEvents(plan, ++sequence)) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end('{"error":"invalid fixture request"}');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createFixtureServer().listen(PORT, '0.0.0.0', () => console.log(`M4 provider fixture listening on ${PORT}`));
}
