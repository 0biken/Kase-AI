/** Executed only by the isolated Docker proof driver, never by ordinary Jest. */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { BudgetService } from './budget.service';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(['proof_clean', 'proof_upgrade'].includes(url.pathname.slice(1)));
  assert.equal(process.env.KASE_M4_DISPOSABLE_DATABASE, 'true');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await db.organization.create({ data: { id: 'proof-org', name: 'Disposable proof', slug: 'proof-org' } });
    await db.project.create({ data: { id: 'proof-project', organizationId: 'proof-org', name: 'Disposable proof', slug: 'proof-project', defaultGatePolicyId: 'unused-proof-policy' } });
    async function audit(id: string) {
      await db.audit.create({ data: { id, projectId: 'proof-project', mode: 'full', status: 'running', requestedCategories: ['blackbox'], executedCategories: [], notExecutedCategories: [], degradationReasons: [] } });
      await db.auditAiSnapshot.create({ data: { auditId: id, provider: 'openai', modelId: 'fixture-only', catalogRevision: 1, modelContextLimit: 1000, modelOutputLimit: 100, credentialMode: 'platform', methodologyDigest: 'fixture-only', promptVersion: 'fixture-only', budgetTotalTokens: 100, budgetMaxCalls: 10, budgetMaxContextBytes: 1000, budgetMaxOutputTokens: 20, budgetBlackboxTokens: 100, budgetBlackboxCalls: 10, budgetWhiteboxTokens: 100, budgetWhiteboxCalls: 10 } });
      await db.auditAiBudget.create({ data: { auditId: id, totalTokensLimit: 100, totalCallsLimit: 10, contextBytesLimit: 1000 } });
    }
    const budgets = new BudgetService(db as any, {} as any);
    await audit('concurrent');
    const reservations = await Promise.all([
      budgets.reserve('concurrent', 'blackbox', 0, 'one', 40, 20),
      budgets.reserve('concurrent', 'blackbox', 0, 'two', 40, 20),
    ]);
    assert.equal(reservations.filter(row => row.allowed).length, 1, 'concurrent reservations must not overspend');
    assert.equal((await db.auditAiBudget.findUniqueOrThrow({ where: { auditId: 'concurrent' } })).totalTokensReserved, 60);
    const reservationId = reservations.find(row => row.allowed)!.reservationId;
    await Promise.all(Array.from({ length: 4 }, () => budgets.settle({ reservationId, actualInput: 15, actualOutput: 5, actualCached: 7 })));
    assert.equal(await db.aiUsage.count({ where: { auditId: 'concurrent' } }), 1);
    const settled = await db.auditAiBudget.findUniqueOrThrow({ where: { auditId: 'concurrent' } });
    assert.equal(settled.totalTokensConsumed, 20);
    assert.equal(settled.totalTokensReserved, 0);
    assert.equal(settled.totalCallsConsumed, 1);

    await audit('recovery');
    const pending = await budgets.reserve('recovery', 'blackbox', 0, 'crashed', 10, 20);
    assert.equal(pending.allowed, true);
    // A fresh service instance reconstructs outstanding spend from PostgreSQL.
    await new BudgetService(db as any, {} as any).recoverRun('recovery', 'blackbox');
    assert.equal((await db.aiBudgetReservation.findUniqueOrThrow({ where: { id: pending.reservationId } })).status, 'expired');
    assert.equal((await db.auditAiBudget.findUniqueOrThrow({ where: { auditId: 'recovery' } })).totalTokensConsumed, 30);
    assert.equal((await budgets.reserve('recovery', 'blackbox', 0, 'crashed', 10, 20)).allowed, false);

    for (const reason of ['cancelled', 'deadline']) {
      await audit(reason);
      if (reason === 'cancelled') await db.audit.update({ where: { id: reason }, data: { cancellationRequestedAt: new Date() } });
      else await db.auditAiBudget.update({ where: { auditId: reason }, data: { deadlineAt: new Date(0) } });
      assert.equal((await budgets.reserve(reason, 'blackbox', 0, 'blocked', 1, 1)).allowed, false);
      assert.equal(await db.aiBudgetReservation.count({ where: { auditId: reason } }), 0);
    }
    await assert.rejects(db.codeMap.create({ data: { id: 'unscoped-runtime-map' } }), 'runtime maps must have provenance');
    if (url.pathname === '/proof_upgrade') assert.equal((await db.codeMap.findUniqueOrThrow({ where: { id: 'legacy-proof-map' } })).legacy, true);
    console.log('KASE_M4_POSTGRES_BEHAVIOR_VERIFIED');
  } finally { await db.$disconnect(); }
}

main().catch(() => { console.error('M4 PostgreSQL behavioral assertion failed; no success evidence emitted'); process.exitCode = 1; });
