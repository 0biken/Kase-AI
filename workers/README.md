# Kase worker images

M1 ships one hardened base and five family stages from [`Dockerfile`](Dockerfile): `worker-recon`, `worker-browser`, `worker-sast`, `worker-deps`, and `worker-agent`. Only recon executes an adapter in M1; the other stages establish the isolation contract without claiming production adapter support.

## Security contract

- UID/GID `10001:10001`; no root runtime.
- Read-only root filesystem, all Linux capabilities dropped, `no-new-privileges` enabled.
- Default-deny seccomp allowlist from `infra/seccomp/worker.json`.
- No Docker socket and no host bind mounts.
- Writable paths are tmpfs only: `/tmp` and `/run/kase-secrets`.
- Queue payloads carry IDs only. A worker leases and decrypts an active secret at job start, registers it with the redactor, writes a short-lived tool config to secret tmpfs, and removes it in `finally`.
- Recon reaches the fixture only through Squid on the private `recon-egress` network. The agent image is not attached to that network or the target network.

## Local verification

Set `KASE_LOCAL_KEK` to a base64-encoded 32-byte key, then bring up the Compose stack. The `minio-init` one-shot creates `kase-evidence`; migrations complete before the API and worker start.

The `security-check` profile runs the agent isolation probe. It succeeds only when the process is non-root and the fixture is unreachable both directly and through the recon proxy.

The M1 exit criterion is not complete until the Linux container engine runs the full stack and evidence bytes, database SHA-256, proxy denial log, and agent isolation probe are all verified.
