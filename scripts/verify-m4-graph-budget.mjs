#!/usr/bin/env node
import { runLocalProof } from './m4-local-test-proof.mjs';
runLocalProof('G2', ["orchestrator/job-graph.spec.ts","orchestrator/audit-job-lifecycle.service.spec.ts","orchestrator/audit-cancellation.spec.ts","agent-runtime/budget/budget.service.spec.ts","agent-runtime/agent-loop.service.spec.ts"], 'KASE_M4_GRAPH_BUDGET_VERIFIED');
