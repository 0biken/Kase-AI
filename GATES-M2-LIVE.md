# Gates: Kase M2 live Compose proof

Scope: Wire and prove the deterministic M2 runtime in the retained Docker Compose stack without introducing AI workloads.

Reference live run: recovery audit `aud_01M1V1QS159Q6BNPT9S1FE1GDQ`; evidence SHA-256 `b65b74f89f5004f63f5efb5c5dfa48150b81df5e8bfe6b34af8e83ef5a442593`; cancelled audit `aud_01M1V1TPNWZ5860SFQHC4DZMF0`; tombstone `evidence_20d141c29a7924d5b05528de44`. The independently recorded G3 re-verification below ran afterward and is authoritative for closeout.

- [x] G1: the live-proof ledger has decisive runnable oracles
  CHECK: node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M2-LIVE.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G2: Compose declares isolated scheduler, SAST, recon, and retention runtimes with the required security controls
  CHECK: node scripts/verify-m2-compose-static.mjs
  EXPECT: KASE_M2_COMPOSE_STATIC_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=413226f906c3cb3089468c922ffc97702b80de02c23162d6e78a17002675bc51; output-bytes=32

- [x] G3: the retained live stack proves finding normalization, evidence integrity, crash recovery, cancellation, and retention tombstoning
  CHECK: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/m2-compose-proof.ps1 -KeepStack
  EXPECT: M2 proof passed:
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=8d1ab3b6d1aa954a812fa515bc8f9b5b926f8e802c1e1a2da076304b45746173; output-bytes=20914

- [x] G4: the complete static repository recovery and regression suite still passes
  CHECK: node scripts/verify-m2-recovery.mjs
  EXPECT: KASE_M2_RECOVERY_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=b04cae28fc94a0c437f596d31513f8f01bc7115b4e27e1a216f9dc10d65e0221; output-bytes=5218

- [x] G5: the live M2 Compose topology and proof contain no agent or AI-provider workload
  CHECK: node scripts/verify-m2-no-ai.mjs
  EXPECT: KASE_M2_NO_AI_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=5eaf88de31e0f47450ddef15b679cde98c85965449dfef377d240f9b35a6a163; output-bytes=23
