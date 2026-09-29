#!/usr/bin/env node
import { runLocalProof } from './m4-local-test-proof.mjs';
runLocalProof('G1', ["ai-provider/provider-contract.spec.ts","ai-provider/provider-http.spec.ts","agent-runtime/deterministic-isolation.spec.ts","agent-runtime/agent-worker-boot.spec.ts"], 'KASE_M4_PROVIDER_CONTRACTS_VERIFIED');
