import { AgentLoopService } from './agent-loop.service';

function fixture() {
  const run: any = { id: 'run', auditId: 'audit', auditJobId: 'parent', role: 'blackbox', status: 'running', nextTurnSequence: 0, nextCallSequence: 0, currentTranscriptId: null, deadline: new Date(Date.now() + 60000) };
  const invocations = new Map<string, any>();
  const child: any = { id: 'child', status: 'queued' };
  let saved: any = null;
  let turn = 0;
  const db: any = {
    auditAiSnapshot: { findUniqueOrThrow: async () => ({ audit: { projectId: 'project', requestedCategories: ['blackbox'] }, methodologyDigest: 'digest', promptVersion: 'v1', budgetMaxCalls: 10, budgetTotalTokens: 100000, budgetMaxOutputTokens: 100, modelContextLimit: 100000, modelOutputLimit: 1000, modelId: 'pinned' }) },
    auditJob: { findUniqueOrThrow: async ({ where }) => where.id === 'parent' ? { startedAt: new Date(), timeoutMs: 60000 } : child },
    audit: { findUniqueOrThrow: async () => ({ status: 'running' }), update: jest.fn() },
    agentCoverageResult: { findMany: jest.fn(async () => [{ category: 'authorization', outcome: 'finding' }]) },
    agentRun: {
      upsert: async () => run, findUniqueOrThrow: async () => run,
      update: jest.fn(async ({ data }) => {
        for (const [key, value] of Object.entries(data)) run[key] = typeof value === 'object' && value && 'increment' in value ? run[key] + (value as any).increment : value;
        return run;
      }),
    },
    agentToolInvocation: {
      upsert: async ({ create }) => { if (!invocations.has(create.callId)) invocations.set(create.callId, create); return invocations.get(create.callId); },
      findUnique: async ({ where }) => invocations.get(where.agentRunId_turnSequence_callId.callId),
      findUniqueOrThrow: async ({ where }) => [...invocations.values()].find(i => i.id === where.id),
      update: async ({ where, data }) => Object.assign([...invocations.values()].find(i => i.id === where.id), data),
      count: async () => 0,
    },
    $queryRawUnsafe: jest.fn(),
  };
  db.$transaction = async work => work(db);
  const transcripts: any = {
    load: jest.fn(async () => saved ? structuredClone(saved) : null),
    checkpoint: jest.fn(async (_id, _seq, value, next) => { saved = structuredClone(value); run.currentTranscriptId = 'evidence'; run.nextTurnSequence = next; }),
    redact: (_audit, text) => text,
    redactJson: (_audit, value) => structuredClone(value),
    readEvidence: jest.fn(async () => Buffer.from('bounded observation')),
  };
  const provider = { runTurn: jest.fn(async function* () {
    const first = turn++ === 0;
    yield { type: 'tool_call', toolCallId: first ? 'probe' : 'finish', name: first ? 'run_http_probe' : 'finish_audit', arguments: first ? {} : { summary: 'done' } };
    yield { type: 'usage', inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
    yield { type: 'completion', stopReason: 'tool_use', providerRequestId: 'response' };
  }) };
  const capabilities: any = { execute: jest.fn(async (...args) => {
    if (args[6] === 'run_http_probe') {
      invocations.get('probe').childJobId = 'child';
      return { success: true, data: { jobId: 'child' } };
    }
    return { success: true, data: { finished: true } };
  }) };
  const budget: any = { recoverRun: jest.fn(), checkBudget: async () => 'green', reserve: jest.fn(async () => ({ allowed: true, reservationId: 'reservation' })), settle: jest.fn(), expireReservation: jest.fn() };
  const loop = new AgentLoopService({ forAudit: async () => provider } as any, transcripts,
    { buildSystemPrompt: () => ({ role: 'system', content: [{ type: 'text', text: 'policy' }] }), getTools: () => [] } as any,
    capabilities, budget, { append: jest.fn() } as any, db, { verifyIntegrity: async () => 'digest' } as any);
  return { loop, run, child, invocations, db, provider, transcripts, capabilities, budget };
}

describe('M4 agent checkpoint and child continuation', () => {
  it('resumes a committed child without dispatching it again, then finishes after the acknowledgement checkpoint', async () => {
    const f = fixture();
    expect(await f.loop.runTurnLoop('audit', 'parent', 'blackbox')).toEqual({ waitingForJobId: 'child' });
    expect(f.capabilities.execute.mock.calls[0][2]).toBe('parent');
    expect(f.transcripts.checkpoint.mock.invocationCallOrder[1]).toBeLessThan(f.capabilities.execute.mock.invocationCallOrder[0]);
    expect(await f.loop.runTurnLoop('audit', 'parent', 'blackbox')).toEqual({ waitingForJobId: 'child' });
    expect(f.provider.runTurn).toHaveBeenCalledTimes(1);
    f.child.status = 'succeeded'; f.invocations.get('probe').resultEvidenceIds = ['http-evidence'];
    expect(await f.loop.runTurnLoop('audit', 'parent', 'blackbox')).toEqual({ completed: true });
    expect(f.capabilities.execute).toHaveBeenCalledTimes(2);
    expect(f.transcripts.readEvidence).toHaveBeenCalledWith('audit', 'http-evidence');
    expect(f.run.status).toBe('completed');
    expect(f.db.audit.update).not.toHaveBeenCalled();
  });
  it('never dispatches child effects when the assistant checkpoint fails', async () => {
    const f = fixture();
    f.transcripts.checkpoint.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(f.loop.runTurnLoop('audit', 'parent', 'blackbox')).rejects.toThrow('storage unavailable');
    expect(f.capabilities.execute).not.toHaveBeenCalled();
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
  });
  it('rejects another parent job before provider dispatch', async () => {
    const f = fixture();
    await expect(f.loop.runTurnLoop('audit', 'wrong-parent', 'blackbox')).rejects.toThrow('another job');
    expect(f.provider.runTurn).not.toHaveBeenCalled();
  });
  it('does not treat an empty coverage acknowledgement as completed cleanly', async () => {
    const f = fixture();
    await f.loop.runTurnLoop('audit', 'parent', 'blackbox');
    f.child.status = 'succeeded'; f.invocations.get('probe').resultEvidenceIds = [];
    f.db.agentCoverageResult.findMany.mockResolvedValue([]);
    await f.loop.runTurnLoop('audit', 'parent', 'blackbox');
    expect(f.db.audit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ degraded: true }) }));
    expect(f.run.status).toBe('failed');
  });
});


describe('M4 cancellation at asynchronous effect boundaries', () => {
  it('does not start work for an already-aborted attempt', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort(new Error('lease lost'));
    await expect(f.loop.runTurnLoop('audit', 'parent', 'blackbox', controller.signal)).rejects.toThrow('lease lost');
    expect(f.budget.recoverRun).not.toHaveBeenCalled();
    expect(f.transcripts.checkpoint).not.toHaveBeenCalled();
    expect(f.provider.runTurn).not.toHaveBeenCalled();
  });

  it('does not execute a checkpointed capability after a terminal audit', async () => {
    const f = fixture();
    await f.loop.runTurnLoop('audit', 'parent', 'blackbox');
    f.db.audit.findUniqueOrThrow = async () => ({ status: 'failed' });
    await expect(f.loop.runTurnLoop('audit', 'parent', 'blackbox')).rejects.toThrow('already terminal');
    expect(f.capabilities.execute).toHaveBeenCalledTimes(1);
    expect(f.provider.runTurn).toHaveBeenCalledTimes(1);
  });

  it('rechecks cancellation after tool validation reads before any tool effect', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.db.agentToolInvocation.count = async () => { controller.abort(new Error('cancelled during read')); return 0; };
    await expect(f.loop.runTurnLoop('audit', 'parent', 'blackbox', controller.signal)).rejects.toThrow('cancelled during read');
    expect(f.capabilities.execute).not.toHaveBeenCalled();
  });

  it('rejects events from a provider that yields after cancellation and expires its reservation', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.provider.runTurn.mockImplementation(async function* () {
      controller.abort(new Error('cancelled during stream'));
      yield { type: 'tool_call', toolCallId: 'probe', name: 'run_http_probe', arguments: {} };
      yield { type: 'usage', inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
      yield { type: 'completion', stopReason: 'tool_use', providerRequestId: 'response' };
    });
    await expect(f.loop.runTurnLoop('audit', 'parent', 'blackbox', controller.signal)).rejects.toThrow('cancelled during stream');
    expect(f.budget.expireReservation).toHaveBeenCalledWith('reservation');
    expect(f.capabilities.execute).not.toHaveBeenCalled();
    expect(f.transcripts.checkpoint).toHaveBeenCalledTimes(1);
  });
});
