import { Injectable } from '@nestjs/common';
import type { ReplayResult } from './gate-engine';

/**
 * Port for replay verification (12-policy-gate §3). Before an `http_replay`
 * finding may block, the stored exchange is re-issued against the current
 * build. The three outcomes and their effects are enforced by the gate engine;
 * this port only produces the outcome.
 *
 * The real implementation re-issues the request from a sandboxed worker on the
 * recon egress path, and is a later slice (it needs the worker/network stack).
 * Until then the wired default fails closed.
 */
export interface ReplayVerifier {
  verify(input: ReplayRequest): Promise<ReplayResult>;
}

export interface ReplayRequest {
  auditId: string;
  evidenceId: string;
}

export const REPLAY_VERIFIER = Symbol('REPLAY_VERIFIER');

/**
 * Default verifier until the live HTTP re-issue adapter lands: it cannot reach
 * the target, so it reports `error`, which the engine treats as "block stands"
 * (fail closed). This never silently clears a finding. Under the default
 * `observe` policy nothing blocks regardless, so this is inert in practice
 * until a project is promoted.
 */
@Injectable()
export class FailClosedReplayVerifier implements ReplayVerifier {
  async verify(): Promise<ReplayResult> {
    return 'error';
  }
}
