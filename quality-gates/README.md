# Kase completion gates

Kase uses a project-local, commit-pinned copy of [Unlazy](https://github.com/Leonxlnx/unlazy) to make completion claims testable during substantial engineering work. This is a development workflow only. It is not part of the audit runtime, agent capability contract, release policy engine, or target-facing worker fleet.

## Safety boundary

An Unlazy `CHECK:` is shell code with the developer's ambient permissions. Kase therefore applies these rules:

1. Templates are reviewed repository files under `quality-gates/`.
2. Runtime ledgers and evidence live under ignored `.unlazy/` paths.
3. `gates:status` and `gates:lint` do not approve or execute checks.
4. There is deliberately no `gates:approve` package script and no Stop hook. Approval is an explicit command after reviewing every `CHECK`, `EXPECT`, `CWD`, and called script.
5. Unlazy never runs inside API, audit, or worker containers. Product release decisions continue to use Kase's evidence and policy engines.

The vendored source and exact upstream commit are recorded in `.agents/skills/unlazy/KASE_SOURCE.md`.

## Start a ledger

```powershell
npm run gates:init -- m1-closeout m1-closeout
npm run gates:lint -- .unlazy/m1-closeout/GATES.md
npm run gates:status -- .unlazy/m1-closeout/GATES.md
```

Review the resulting ledger and every called script. To approve those exact commands, use Unlazy directly:

```powershell
node .agents/skills/unlazy/scripts/gate-check.mjs --approve .unlazy/m1-closeout/GATES.md
```

After implementation or any relevant dependency change, re-run all checks:

```powershell
npm run gates:reverify -- .unlazy/m1-closeout/GATES.md
```

An unmet or abandoned gate is a handoff, not completion.
