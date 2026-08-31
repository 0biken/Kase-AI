import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');

describe('worker container security contract', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
  const dockerfile = readFileSync(resolve(root, 'workers/Dockerfile'), 'utf8');
  const seccomp = JSON.parse(readFileSync(resolve(root, 'infra/seccomp/worker.json'), 'utf8'));

  it('runs the recon worker non-root with a read-only filesystem and no capabilities', () => {
    expect(dockerfile).toContain('USER 10001:10001');
    expect(compose).toMatch(/worker-recon:[\s\S]*user: "10001:10001"/);
    expect(compose).toMatch(/worker-recon:[\s\S]*read_only: true/);
    expect(compose).toMatch(/worker-recon:[\s\S]*cap_drop:\s+- ALL/);
    expect(compose).toContain('no-new-privileges:true');
  });

  it('mounts secret material on tmpfs and never mounts the Docker socket', () => {
    expect(compose).toContain('/run/kase-secrets:size=4m');
    expect(compose).not.toContain('/var/run/docker.sock');
  });

  it('declares every worker family and an explicit syscall deny profile', () => {
    for (const family of ['recon', 'browser', 'sast', 'deps', 'agent']) {
      expect(dockerfile).toContain(`AS worker-${family}`);
    }
    expect(seccomp.defaultAction).toBe('SCMP_ACT_ERRNO');
    expect(seccomp.syscalls[0].action).toBe('SCMP_ACT_ALLOW');
    expect(seccomp.syscalls[0].names).not.toContain('ptrace');
    expect(seccomp.syscalls[0].names).not.toContain('mount');
  });

  it('keeps the agent check off the target network and without proxy configuration', () => {
    const agent = compose.slice(compose.indexOf('  worker-agent-check:'), compose.indexOf('\nvolumes:'));
    expect(agent).toContain('- kase-core');
    expect(agent).not.toContain('target-net');
    expect(agent).not.toContain('recon-egress');
    expect(agent).not.toContain('KASE_EGRESS_PROXY');
    expect(agent).toContain('--proxy http://egress-proxy:3128');
  });

  it('exposes the egress proxy only to recon workers, never the shared core network', () => {
    const proxy = compose.slice(compose.indexOf('  egress-proxy:'), compose.indexOf('\n  migrate:'));
    const recon = compose.slice(compose.indexOf('  worker-recon:'), compose.indexOf('\n  worker-agent-check:'));
    expect(proxy).toContain('- recon-egress');
    expect(proxy).not.toContain('- kase-core');
    expect(recon).toContain('- recon-egress');
  });
});
