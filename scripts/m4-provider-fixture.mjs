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

/**
 * One-shot hold control for the G5 crash and cancellation scenarios. When armed, the next
 * provider request receives its stream headers and first event, then stalls until it is
 * released or the client disconnects (a killed worker or an aborted turn). Control routes
 * answer only loopback callers, so they are reachable via `docker compose exec` but not
 * through the agent egress proxy.
 */
export function createHoldControl() {
  const state = { armed: false, held: 0, aborted: 0, released: 0 };
  let release;
  return {
    state,
    arm() { state.armed = true; },
    release() { if (release) { release(); release = undefined; state.released += 1; } },
    /** Returns a promise (resolving to 'released') when this request should be held, else undefined. */
    take() {
      if (!state.armed) return undefined;
      state.armed = false;
      state.held += 1;
      return new Promise(resolvePromise => { release = () => resolvePromise('released'); });
    },
    abort() { release = undefined; state.aborted += 1; },
  };
}

const isLoopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

export function createFixtureServer() {
  let sequence = 0;
  const hold = createHoldControl();
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (request.url?.startsWith('/control/')) {
      if (!isLoopback(request.socket.remoteAddress)) { response.writeHead(403).end(); return; }
      if (request.method === 'POST' && request.url === '/control/hold') hold.arm();
      else if (request.method === 'POST' && request.url === '/control/release') hold.release();
      else if (!(request.method === 'GET' && request.url === '/control/state')) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(hold.state));
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
      const events = sseEvents(plan, ++sequence);
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const held = hold.take();
      if (held) {
        response.write(`data: ${JSON.stringify(events.shift())}\n\n`);
        const outcome = await Promise.race([held, new Promise(resolvePromise => response.on('close', () => resolvePromise('aborted')))]);
        if (outcome === 'aborted' || response.destroyed) { hold.abort(); return; }
      }
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
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
