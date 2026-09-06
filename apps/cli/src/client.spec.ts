import assert from 'node:assert/strict';
import test from 'node:test';
import { KaseClient, parseSse, resolveNamed } from './client';

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } });
}

test('keeps the token in the authorization header and starts identifier-based audits', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ id: 'aud_1', status: 'queued' }), { status: 200 });
    }) as typeof fetch;
    const client = new KaseClient('http://kase/api/v1/', 'secret-token', fetcher);
    await client.startAudit('prj_1', { targetId: 'tgt_1', repositoryId: 'repo_1', mode: 'security' });
    const [url, init] = calls[0];
    assert.equal(url, 'http://kase/api/v1/projects/prj_1/audits');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret-token');
    assert.doesNotMatch(JSON.stringify(init?.body), /secret-token/);
  });

test('parses resumable SSE ids and JSON data', async () => {
    const events: unknown[] = [];
    for await (const event of parseSse(stream('id: 7\nevent: status\ndata: {"status":"completed"}\n\n'))) events.push(event);
    assert.deepEqual(events, [{ id: '7', type: 'status', data: { status: 'completed' } }]);
  });

test('recognises persisted audit.status events and fetches the terminal record', async () => {
    const calls: Array<{ url: string; lastEventId: string | null }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), lastEventId: new Headers(init?.headers).get('last-event-id') });
      if (String(url).endsWith('/events')) {
        return new Response(stream('id: 9\nevent: audit.status\ndata: {"status":"completed"}\n\n'), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'aud_1', status: 'completed' }), { status: 200 });
    }) as typeof fetch;
    const terminal = await new KaseClient('http://kase/api/v1', 'token', fetcher).waitForAudit('aud_1', () => undefined);
    assert.equal(terminal.status, 'completed');
    assert.equal(calls[0].url, 'http://kase/api/v1/audits/aud_1/events');
    assert.equal(calls[1].url, 'http://kase/api/v1/audits/aud_1');
  });

test('resolves exact names and refuses ambiguity', async () => {
    assert.equal(await resolveNamed([{ id: 'tgt_1', name: 'staging' }], 'staging', 'tgt', ['name'], 'target'), 'tgt_1');
    await assert.rejects(resolveNamed([{ id: 'tgt_1', name: 'x' }, { id: 'tgt_2', name: 'x' }], 'x', 'tgt', ['name'], 'target'), /ambiguous/);
});
