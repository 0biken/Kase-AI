import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditEventsService } from '../../audit-events/audit-events.service';
import { deterministicId } from '../../findings/finding-persistence.service';
import { degradationStateFor, DegradationState } from './budget-defaults';

export interface ReservationResult { reservationId: string; allowed: boolean; degradationState: DegradationState; budgetSufficient: boolean }
export interface SettlementInput { reservationId: string; actualInput: number; actualOutput: number; actualCached: number; providerRequestId?: string; latencyMs?: number; retries?: number; outcome?: string }
export interface BudgetState { degradationState: DegradationState; totalTokensFraction: number; totalCallsFraction: number; bbTokensFraction: number; wbTokensFraction: number }
const order: DegradationState[] = ['green', 'yellow', 'red', 'exceeded'];
@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService, private readonly events: AuditEventsService) {}
  private async lock(tx: any, auditId: string) {
    await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', auditId);
  }
  async reserve(auditId: string, agentRole: 'blackbox' | 'whitebox', turnSequence: number, callId: string, estimatedInput: number, maxOutput: number, contextBytes = 0): Promise<ReservationResult> {
    for (const n of [estimatedInput, maxOutput, contextBytes]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid reservation size');
    const id = deterministicId('aiBudgetReservation', auditId + ':' + agentRole + ':' + turnSequence + ':' + callId);
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, auditId);
      const prior = await tx.aiBudgetReservation.findUnique({ where: { id } });
      const budget = await tx.auditAiBudget.findUniqueOrThrow({ where: { auditId } });
      // Replaying an allocation must never authorize a second provider effect.
      if (prior) return { reservationId: id, allowed: false, budgetSufficient: false, degradationState: budget.degradationState as DegradationState };
      const snapshot = await tx.auditAiSnapshot.findUniqueOrThrow({ where: { auditId } });
      const audit = await tx.audit.findUniqueOrThrow({ where: { id: auditId } });
      const prefix = agentRole === 'blackbox' ? 'bb' : 'wb';
      const stageTokens = agentRole === 'blackbox' ? snapshot.budgetBlackboxTokens : snapshot.budgetWhiteboxTokens;
      const stageCalls = agentRole === 'blackbox' ? snapshot.budgetBlackboxCalls : snapshot.budgetWhiteboxCalls;
      const tokens = estimatedInput + maxOutput;
      const used = budget.totalTokensConsumed + budget.totalTokensReserved;
      const calls = budget.totalCallsConsumed + budget.totalCallsReserved;
      const allowed = !audit.cancellationRequestedAt && ['queued', 'running'].includes(audit.status) &&
        (!budget.deadlineAt || budget.deadlineAt > new Date()) && budget.degradationState !== 'exceeded' &&
        used + tokens <= budget.totalTokensLimit && calls + 1 <= budget.totalCallsLimit &&
        budget[prefix + 'TokensConsumed'] + budget[prefix + 'TokensReserved'] + tokens <= stageTokens &&
        budget[prefix + 'CallsConsumed'] + budget[prefix + 'CallsReserved'] + 1 <= stageCalls;
      if (!allowed) {
        await this.transition(tx, auditId, budget.degradationState as DegradationState, 'exceeded');
        return { reservationId: id, allowed: false, budgetSufficient: false, degradationState: 'exceeded' };
      }
      await tx.aiBudgetReservation.create({ data: { id, auditId, agentRole, turnSequence, callId, estimatedInput, maxOutput, contextBytes, status: 'active' } });
      const data = { totalTokensReserved: { increment: tokens }, totalCallsReserved: { increment: 1 },
        [prefix + 'TokensReserved']: { increment: tokens }, [prefix + 'CallsReserved']: { increment: 1 } };
      const next = await tx.auditAiBudget.update({ where: { auditId }, data });
      const state = this.compute(next, snapshot);
      await this.transition(tx, auditId, budget.degradationState as DegradationState, state.degradationState);
      return { reservationId: id, allowed: true, budgetSufficient: true, degradationState: state.degradationState };
    });
  }
  async settle(input: SettlementInput): Promise<BudgetState> {
    for (const n of [input.actualInput, input.actualOutput, input.actualCached]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid provider usage');
    const ref = await this.prisma.aiBudgetReservation.findUniqueOrThrow({ where: { id: input.reservationId } });
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, ref.auditId);
      const reservation = await tx.aiBudgetReservation.findUniqueOrThrow({ where: { id: ref.id } });
      const before = await tx.auditAiBudget.findUniqueOrThrow({ where: { auditId: ref.auditId } });
      const snapshot = await tx.auditAiSnapshot.findUniqueOrThrow({ where: { auditId: ref.auditId } });
      if (reservation.status !== 'active') return this.compute(before, snapshot);
      const prefix = reservation.agentRole === 'blackbox' ? 'bb' : 'wb';
      const estimate = reservation.estimatedInput + reservation.maxOutput;
      const actual = input.actualInput + input.actualOutput;
      await tx.aiBudgetReservation.update({ where: { id: ref.id }, data: { status: input.outcome === 'unknown' ? 'expired' : 'settled', settledInput: input.actualInput, settledOutput: input.actualOutput, settledCached: input.actualCached, settledAt: new Date() } });
      const next = await tx.auditAiBudget.update({ where: { auditId: ref.auditId }, data: {
        totalTokensReserved: { decrement: estimate }, totalCallsReserved: { decrement: 1 }, totalTokensConsumed: { increment: actual }, totalCallsConsumed: { increment: 1 },
        [prefix + 'TokensReserved']: { decrement: estimate }, [prefix + 'CallsReserved']: { decrement: 1 },
        [prefix + 'TokensConsumed']: { increment: actual }, [prefix + 'CallsConsumed']: { increment: 1 },
      } });
      const run = await tx.agentRun.findUnique({ where: { auditId_role: { auditId: ref.auditId, role: ref.agentRole } } });
      await tx.aiUsage.create({ data: { id: deterministicId('aiUsage', ref.id), auditId: ref.auditId, agentRunId: run?.id, stage: ref.agentRole,
        provider: snapshot.provider, model: snapshot.modelId, providerRequestId: input.providerRequestId,
        inputTokens: input.actualInput, outputTokens: input.actualOutput, cachedTokens: input.actualCached,
        latencyMs: input.latencyMs ?? 0, retries: input.retries ?? 0, outcome: input.outcome ?? 'success' } });
      const state = this.compute(next, snapshot);
      await this.transition(tx, ref.auditId, before.degradationState as DegradationState, state.degradationState);
      return state;
    });
  }
  async expireReservation(id: string): Promise<void> {
    const row = await this.prisma.aiBudgetReservation.findUniqueOrThrow({ where: { id } });
    await this.settle({ reservationId: id, actualInput: row.estimatedInput, actualOutput: row.maxOutput, actualCached: 0, outcome: 'unknown' });
  }
  async recoverRun(auditId: string, role: string): Promise<void> {
    const pending = await this.prisma.aiBudgetReservation.findMany({ where: { auditId, agentRole: role, status: 'active' } });
    for (const row of pending) await this.expireReservation(row.id);
  }
  async checkState(auditId: string): Promise<BudgetState> {
    const [budget, snapshot] = await Promise.all([
      this.prisma.auditAiBudget.findUniqueOrThrow({ where: { auditId } }),
      this.prisma.auditAiSnapshot.findUniqueOrThrow({ where: { auditId } }),
    ]);
    return this.compute(budget, snapshot);
  }
  async checkBudget(auditId: string): Promise<DegradationState> { return (await this.checkState(auditId)).degradationState; }
  private compute(b: any, snapshot: { budgetBlackboxTokens: number; budgetWhiteboxTokens: number; budgetBlackboxCalls: number; budgetWhiteboxCalls: number }): BudgetState {
    const tokenFraction = (b.totalTokensConsumed + b.totalTokensReserved) / b.totalTokensLimit;
    const callFraction = (b.totalCallsConsumed + b.totalCallsReserved) / b.totalCallsLimit;
    const bbFraction = (b.bbTokensConsumed + b.bbTokensReserved) / snapshot.budgetBlackboxTokens;
    const wbFraction = (b.wbTokensConsumed + b.wbTokensReserved) / snapshot.budgetWhiteboxTokens;
    const bbCalls = (b.bbCallsConsumed + b.bbCallsReserved) / snapshot.budgetBlackboxCalls;
    const wbCalls = (b.wbCallsConsumed + b.wbCallsReserved) / snapshot.budgetWhiteboxCalls;
    const computed = degradationStateFor(Math.max(tokenFraction, callFraction, bbFraction, wbFraction, bbCalls, wbCalls));
    return { degradationState: order[Math.max(order.indexOf(b.degradationState), order.indexOf(computed))],
      totalTokensFraction: tokenFraction, totalCallsFraction: callFraction,
      bbTokensFraction: bbFraction, wbTokensFraction: wbFraction };
  }
  private async transition(tx: any, auditId: string, from: DegradationState, to: DegradationState) {
    if (order.indexOf(to) <= order.indexOf(from)) return;
    await tx.auditAiBudget.update({ where: { auditId }, data: { degradationState: to, degradedAt: new Date() } });
    await tx.audit.update({ where: { id: auditId }, data: { degraded: true, degradationReasons: { push: 'budget_' + to } } });
    // Append within the same audit lock: an external event transaction would deadlock.
    const last = await tx.auditEvent.findFirst({ where: { auditId }, orderBy: { sequence: 'desc' } });
    await tx.auditEvent.create({ data: { id: deterministicId('auditEvent', auditId + ':budget:' + to), auditId, sequence: (last?.sequence ?? 0) + 1, type: 'budget.transition', data: { from, to } } });
  }
}

