#!/usr/bin/env node
import { runLocalProof } from './m4-local-test-proof.mjs';
runLocalProof('G3', ["worker/agent-tools.spec.ts","agent-runtime/capabilities/capability.schemas.spec.ts"], 'KASE_M4_CAPABILITY_SECURITY_VERIFIED');
