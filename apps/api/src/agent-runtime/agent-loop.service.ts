import { Injectable } from '@nestjs/common';
import type { ProviderMessage, ProviderEvent, ProviderToolCall, ProviderUsage, ProviderCompletion } from '../ai-provider/ai-provider.interface';
import { ProviderEventSchema } from '../ai-provider/provider-event.schema';
import { ProviderResolver } from '../ai-provider/provider-resolver.service';
import { MAX_RETRIES, backoffMs, sleep } from '../ai-provider/retry-strategy';
import { TranscriptService } from './transcript.service';
import { PromptBuilder } from './prompt-builder';
import { CapabilityExecutor, CapabilityResult } from './capabilities/capability.executor';
import { BudgetService } from './budget/budget.service';
import { AuditEventsService } from '../audit-events/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { deterministicId } from '../findings/finding-persistence.service';
import { MethodologyGuard } from './methodology.guard';
import { PermanentJobError } from '../orchestrator/retry-policy';

export interface LoopOutcome { waitingForJobId?: string; completed?: boolean }
@Injectable()
export class AgentLoopService {
  constructor(private readonly providers: ProviderResolver, private readonly transcripts: TranscriptService,
    private readonly prompts: PromptBuilder, private readonly capabilities: CapabilityExecutor,
    private readonly budget: BudgetService, private readonly events: AuditEventsService,
    private readonly prisma: PrismaService, private readonly methodology: MethodologyGuard) {}
  async runTurnLoop(auditId: string, auditJobId: string, role: 'blackbox' | 'whitebox', signal?: AbortSignal): Promise<LoopOutcome> {
    signal?.throwIfAborted();
    const snapshot = await this.prisma.auditAiSnapshot.findUniqueOrThrow({ where: { auditId }, include: { audit: true } });
    if (await this.methodology.verifyIntegrity() !== snapshot.methodologyDigest) throw new PermanentJobError('Frozen methodology no longer matches');
    const job = await this.prisma.auditJob.findUniqueOrThrow({ where: { id: auditJobId } });
    let run = await this.prisma.agentRun.upsert({ where: { auditId_role: { auditId, role } },
      create: { id: deterministicId('agentRun', auditId + ':' + role), auditId, auditJobId, role, status: 'running',
        promptVersion: snapshot.promptVersion, deadline: new Date((job.startedAt ?? new Date()).getTime() + job.timeoutMs) }, update: {} });
    if (run.auditJobId !== auditJobId) throw new PermanentJobError('Agent run belongs to another job');
    if (run.status === 'completed') return { completed: true };
    await this.budget.recoverRun(auditId, role);
    const context = { auditId, role, targetId: snapshot.audit.targetId, requestedCategories: snapshot.audit.requestedCategories,
      remainingCalls: snapshot.budgetMaxCalls, remainingTokens: snapshot.budgetTotalTokens };
    let messages = (await this.transcripts.load(run.id))?.messages ?? [
      this.prompts.buildSystemPrompt(role, context),
      { role: 'user' as const, content: [{ type: 'text' as const, text: role === 'blackbox'
        ? 'Audit the target using the endpoint inventory and available test identities. Investigate supported categories, record evidence-backed findings, passing checks and blocked coverage, then finish.'
        : 'Audit the repository at the frozen commit using the route map and bounded source excerpts. Investigate supported categories and record evidence-backed findings, passing checks and blocked coverage, then finish.' }] },
    ];
    if (!run.currentTranscriptId) await this.transcripts.checkpoint(run.id, -1, { messages }, 0);
    await this.events.append(auditId, 'agent.started', { runId: run.id, role });
    for (;;) {
      signal?.throwIfAborted();
      run = await this.prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      if (run.deadline && run.deadline <= new Date()) {
        await this.degrade(auditId, run.id, 'agent_deadline');
        throw new PermanentJobError('Agent deadline exceeded');
      }
      const audit = await this.prisma.audit.findUniqueOrThrow({ where: { id: auditId } });
      if (audit.cancellationRequestedAt || audit.status === 'cancelled') throw new Error('Audit cancellation requested');
      if (!['queued', 'running'].includes(audit.status)) throw new PermanentJobError('Audit is already terminal');
      const state = await this.budget.checkBudget(auditId);
      const last = messages.at(-1);
      // Resume the acknowledgement-to-terminal window without a second model
      // call if the worker crashed immediately after checkpointing finish.
      if (last?.role === 'tool_result') {
        const assistant = messages.at(-2);
        const finishedCall = assistant?.role === 'assistant'
          ? assistant.content.find(b => b.type === 'tool_use' && b.name === 'finish_audit') : undefined;
        if (finishedCall?.type === 'tool_use') {
          const acknowledged = await this.prisma.agentToolInvocation.findUnique({ where: {
            agentRunId_turnSequence_callId: { agentRunId: run.id, turnSequence: run.nextTurnSequence - 1, callId: finishedCall.toolCallId },
          } });
          if ((acknowledged?.result as unknown as CapabilityResult)?.success) return this.complete(auditId, run.id);
        }
      }
      const tool = last?.role === 'assistant' ? last.content.find(b => b.type === 'tool_use') : undefined;
      if (tool?.type === 'tool_use') {
        const turn = run.nextTurnSequence - 1;
        const callId = tool.toolCallId;
        const id = deterministicId('agentToolInvocation', run.id + ':' + turn + ':' + callId);
        let invocation = await this.prisma.agentToolInvocation.upsert({
          where: { agentRunId_turnSequence_callId: { agentRunId: run.id, turnSequence: turn, callId } },
          create: { id, agentRunId: run.id, turnSequence: turn, callId, providerCallId: callId, capability: tool.name,
            arguments: this.transcripts.redactJson(auditId, tool.arguments) as never, argumentsValid: false, status: 'pending' }, update: {},
        });
        let result: CapabilityResult;
        if (invocation.result) result = invocation.result as unknown as CapabilityResult;
        else if (invocation.childJobId) {
          const child = await this.prisma.auditJob.findUniqueOrThrow({ where: { id: invocation.childJobId } });
          if (!['succeeded', 'failed', 'timed_out', 'cancelled', 'skipped'].includes(child.status)) {
            await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'waiting_for_tool', waitingForJobId: child.id } });
            return { waitingForJobId: child.id };
          }
          if (child.status !== 'succeeded') result = { success: false, error: 'tool_failed', message: child.errorClass ?? child.status };
          else {
            const observations: Array<{ evidenceId: string; observation: string }> = [];
            for (const evidenceId of invocation.resultEvidenceIds.slice(0, 5)) {
              const bytes = await this.transcripts.readEvidence(auditId, evidenceId);
              observations.push({ evidenceId, observation: this.transcripts.redact(auditId, bytes.subarray(0, 16000).toString('utf8')) });
            }
            result = { success: true, data: { evidenceIds: invocation.resultEvidenceIds, observations, untrusted: true } };
          }
        } else if ((state === 'red' || state === 'exceeded') && !['finish_audit', 'create_finding', 'attach_evidence', 'record_passing_check', 'report_blocked'].includes(tool.name)) {
          result = { success: false, error: 'budget_exhausted', message: 'Stop exploration and finish with existing results' };
        } else {
          const priorInvalid = await this.prisma.agentToolInvocation.count({ where: { agentRunId: run.id, capability: tool.name, argumentsValid: false, status: 'delivered' } });
          // Database reads can outlive cancellation or lease loss. Recheck at
          // the effect boundary before dispatching a child or persisting a finding.
          signal?.throwIfAborted();
          result = await this.capabilities.execute(auditId, snapshot.audit.projectId, auditJobId, role, turn, callId, tool.name, tool.arguments, priorInvalid);
          if (result.success && typeof result.data?.jobId === 'string') {
            await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'waiting_for_tool', waitingForJobId: result.data.jobId } });
            return { waitingForJobId: result.data.jobId };
          }
          if (result.error === 'validation_limit_exceeded') await this.degrade(auditId, run.id, 'validation_limit_exceeded');
        }
        const safeResult = this.transcripts.redactJson(auditId, result);
        await this.prisma.$transaction(async tx => {
          await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', auditId);
          const stored = await tx.agentToolInvocation.findUniqueOrThrow({ where: { id: invocation.id } });
          if (!stored.result && ['get_source', 'search_source'].includes(tool.name) && safeResult.success) {
            const bytes = Buffer.byteLength(JSON.stringify(safeResult.data));
            const contextBudget = await tx.auditAiBudget.findUniqueOrThrow({ where: { auditId } });
            if (contextBudget.contextBytesConsumed + bytes > contextBudget.contextBytesLimit) {
              safeResult.success = false;
              delete safeResult.data;
              safeResult.error = 'context_budget_exhausted';
              await tx.audit.update({ where: { id: auditId }, data: { degraded: true, degradationReasons: { push: 'context_budget_exhausted' } } });
            } else {
              await tx.auditAiBudget.update({ where: { auditId }, data: { contextBytesConsumed: { increment: bytes } } });
            }
          }
          await tx.agentToolInvocation.update({ where: { id: invocation.id }, data: { result: JSON.parse(JSON.stringify(safeResult)),
            status: 'completed', completedAt: new Date(), argumentsValid: !['validation_error', 'validation_limit_exceeded'].includes(safeResult.error ?? '') } });
        });
        messages.push({ role: 'tool_result', content: [{ type: 'tool_result', toolCallId: tool.toolCallId,
          content: '<UNTRUSTED_DATA>\n' + JSON.stringify(safeResult) + '\n</UNTRUSTED_DATA>', isError: !safeResult.success }] });
        await this.transcripts.checkpoint(run.id, turn, { messages }, run.nextTurnSequence);
        await this.prisma.agentToolInvocation.update({ where: { id: invocation.id }, data: { status: 'delivered' } });
        await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'running', waitingForJobId: null } });
        await this.events.append(auditId, 'agent.tool_result', { runId: run.id, toolCallId: callId, success: safeResult.success });
        if (tool.name === 'finish_audit' && safeResult.success) return this.complete(auditId, run.id);
        continue;
      }
      if (state === 'exceeded' || run.nextTurnSequence >= snapshot.budgetMaxCalls) {
        await this.degrade(auditId, run.id, 'budget_exhausted');
        return { completed: true };
      }
      const turn = run.nextTurnSequence;
      let output: ProviderEvent[] = [];
      for (let retry = 0; retry <= MAX_RETRIES; retry++) {
        signal?.throwIfAborted();
        const cursor = await this.prisma.agentRun.update({ where: { id: run.id }, data: { nextCallSequence: { increment: 1 } } });
        const tools = this.prompts.getTools(role).filter(t => state !== 'red' || ['finish_audit', 'create_finding', 'attach_evidence', 'record_passing_check', 'report_blocked'].includes(t.name));
        const contextBytes = Buffer.byteLength(JSON.stringify({ messages, tools }));
        // Keep provider token accounting separate from the exact context-window
        // byte allowance, which is enforced before dispatch.
        // One token per UTF-8 byte is a conservative bound; a four-byte
        // average can under-reserve code and non-ASCII inputs substantially.
        const estimatedInput = contextBytes;
        if (!Number.isSafeInteger(snapshot.modelContextLimit) || !Number.isSafeInteger(snapshot.modelOutputLimit) ||
            estimatedInput + snapshot.budgetMaxOutputTokens > snapshot.modelContextLimit ||
            snapshot.budgetMaxOutputTokens > snapshot.modelOutputLimit) {
          await this.degrade(auditId, run.id, 'model_context_or_output_limit');
          return { completed: true };
        }
        const reservation = await this.budget.reserve(auditId, role, turn, String(cursor.nextCallSequence), estimatedInput, snapshot.budgetMaxOutputTokens, contextBytes);
        if (!reservation.allowed) { await this.degrade(auditId, run.id, 'budget_exhausted'); return { completed: true }; }
        const started = Date.now();
        let usage: ProviderUsage | undefined;
        let completion: ProviderCompletion | undefined;
        try {
          const provider = await this.providers.forAudit(auditId);
          signal?.throwIfAborted();
          output = [];
          await this.events.append(auditId, 'agent.turn_started', { runId: run.id, turn, retry });
          for await (const raw of provider.runTurn({ modelId: snapshot.modelId, messages, tools, maxOutputTokens: snapshot.budgetMaxOutputTokens,
            budgetHandle: { auditId, agentRole: role, turnSequence: turn }, temperature: 0 }, signal)) {
            signal?.throwIfAborted();
            const event = ProviderEventSchema.parse(raw);
            output.push(event);
            if (event.type === 'usage') usage = event;
            if (event.type === 'completion') completion = event;
          }
          if (usage) await this.budget.settle({ reservationId: reservation.reservationId, actualInput: usage.inputTokens,
            actualOutput: usage.outputTokens, actualCached: usage.cachedTokens, providerRequestId: completion?.providerRequestId, latencyMs: Date.now() - started, retries: retry });
          else await this.budget.expireReservation(reservation.reservationId);
        } catch (error) { await this.budget.expireReservation(reservation.reservationId); throw error; }
        const error = output.find(e => e.type === 'retryable_error' || e.type === 'permanent_error');
        if (error?.type === 'retryable_error' && retry < MAX_RETRIES) { await sleep(backoffMs(retry, error.retryAfterMs), signal); continue; }
        if (error) throw new PermanentJobError('Provider request failed after bounded retries');
        if (!completion || !usage) throw new PermanentJobError('Provider did not report completion and usage');
        break;
      }
      signal?.throwIfAborted();
      if (output.some(e => e.type === 'refusal')) { await this.degrade(auditId, run.id, 'provider_refusal'); return { completed: true }; }
      if (output.some(e => e.type === 'completion' && e.stopReason === 'max_tokens')) { await this.degrade(auditId, run.id, 'provider_truncation'); return { completed: true }; }
      const calls = output.filter((e): e is ProviderToolCall => e.type === 'tool_call');
      if (calls.length > 1) throw new PermanentJobError('Provider returned parallel tool calls');
      const text = output.filter(e => e.type === 'text_delta').map(e => e.text).join('');
      const content: ProviderMessage['content'][number][] = [];
      if (text) content.push({ type: 'text', text: this.transcripts.redact(auditId, text) });
      for (const call of calls) content.push({ type: 'tool_use', toolCallId: call.toolCallId, name: call.name, arguments: this.transcripts.redactJson(auditId, call.arguments) });
      if (!content.length) content.push({ type: 'text', text: 'Provider completed without content' });
      messages.push({ role: 'assistant', content });
      await this.transcripts.checkpoint(run.id, turn, { messages }, turn + 1);
      await this.events.append(auditId, 'agent.turn_completed', { runId: run.id, turn });
      if (!calls.length) {
        await this.degrade(auditId, run.id, 'agent_finished_without_coverage_acknowledgement');
        return { completed: true };
      }
    }
  }
  private async complete(auditId: string, runId: string): Promise<LoopOutcome> {
    const run = await this.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const coverage = await this.prisma.agentCoverageResult.findMany({ where: { auditId, agentRole: run.role } });
    if (!coverage.length || coverage.some(row => row.outcome === 'blocked')) {
      await this.degrade(auditId, runId, 'agent_coverage_incomplete');
      return { completed: true };
    }
    await this.prisma.agentRun.update({ where: { id: runId }, data: { status: 'completed', finishedAt: new Date(), waitingForJobId: null } });
    await this.events.append(auditId, 'agent.completed', { runId });
    return { completed: true };
  }
  private async degrade(auditId: string, runId: string, reason: string) {
    await this.prisma.audit.update({ where: { id: auditId }, data: { degraded: true, degradationReasons: { push: reason } } });
    await this.prisma.agentRun.update({ where: { id: runId }, data: { status: reason.includes('budget') ? 'budget_exhausted' : 'failed', finishedAt: new Date() } });
    await this.events.append(auditId, 'agent.degraded', { runId, reason });
  }
}

