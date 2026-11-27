<!-- kase:pr-audit -->
## Kase audit — FAIL — 2 blocking findings

**Commit** `a3f9c1e0b2d4` · **Mode** full · **Duration** 24m · [Full report](https://kase.example.com/dashboard/audits/aud_1)

### Blocking (2)

| Severity | Finding | Location | Rule | Evidence |
|---|---|---|---|---|
| Critical | IDOR allows invoice access across users | `src/invoices/invoice.service.ts:42` · `InvoiceService.find` | `block_on[0] source=deterministic severity=critical` | `ev_1` http\_replay (reproduced) |
| High | Hardcoded API key in source | — | `block_on[1] severity=high` | `ev_2` scanner |

### Warnings (3)

2 × correlation is ai\_inference; not gate-eligible · 1 × high severity without replayable evidence

### Waivers

- 1 finding is waived by an active waiver.
- ⚠ Waiver `fp9abcdef012` expires in 9 days (approved by alex@example.com); the gate blocks again when it lapses.

Open findings: 1 critical, 1 high, 2 medium.

<sub>Coverage: 12/12 requested categories executed · Not degraded · policy v3</sub>
