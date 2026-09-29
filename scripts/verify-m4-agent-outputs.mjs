#!/usr/bin/env node
import { runLocalProof } from './m4-local-test-proof.mjs';
runLocalProof('G4', ["agent-runtime/ai-configuration.spec.ts","agent-runtime/transcript.service.spec.ts","worker/agent-tools.spec.ts"], 'KASE_M4_AGENT_OUTPUTS_VERIFIED');
