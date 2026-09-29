# Finding Format & Severity Rubric — White-Box

Same philosophy as the black-box skill's finding format, adapted for source-grounded evidence. If a project gets both a black-box and white-box audit, the severity rubric below is intentionally identical so findings are comparable across both reports.

## Template

```markdown
## [ID] · [Short title] — **[SEVERITY]**

- **CWE-XXX** (CWE name) — *for security findings; omit for quality/test-coverage findings*
- **Location:** `path/to/file.ext:LINE` (or line range `:START-END`)

**Code:**
```[language]
[short excerpt — just the relevant lines, with enough surrounding context to be self-explanatory, not the whole file]
```

**Root cause:**
[Why this is wrong, in terms of the actual code — not generic advice. Name the specific missing check, the specific unsafe pattern, the specific logic error.]

**Impact:**
[Concrete consequence. If exploitable, describe the exploit path concretely. If it's a latent bug, describe what would trigger it.]

**Fix:**
```diff
- [old line]
+ [new line]
```
[Or, if a diff isn't the cleanest format: an ordered list of specific changes, naming exact functions/files. Include an effort tag: S (hours) / M (a day or two) / L (architectural).]
```

For things checked and found correct, log as `**PASS** ✅` with a one-line note on what was verified and where (`path/to/file.ext:LINE` — confirms ownership check present`). This is what proves the review was thorough rather than just listing convenient bugs.

## Severity rubric

Identical definitions to the black-box skill — use this so findings are comparable if the same project has both audits.

| Severity | Definition | White-box examples |
|---|---|---|
| **Critical** | Exploitable/triggerable today with no special access, causing data exposure, full takeover, or core functionality failure | Hardcoded JWT secret, SQL built via string concatenation on a public endpoint, password stored in plaintext |
| **High** | Exploitable with low effort or affecting a large share of code paths/users | IDOR pattern repeated across multiple endpoints, outdated dependency with known CVE in an auth library, missing server-side authz check behind a UI-only gate |
| **Medium** | Real risk requiring specific conditions, or a less-central code path | Inconsistent input validation on a rarely-used admin form, verbose error messages only in a non-default config |
| **Low / Info** | Hygiene, defense-in-depth, code quality | Missing test coverage on a low-risk utility, minor code duplication, outdated non-security dependency |

## Why file:line citation matters here

The single biggest value-add of white-box over black-box is that every finding is independently verifiable in seconds — a developer can open the exact line instead of having to reproduce an HTTP exchange. Never describe a vulnerability only in prose when you have the actual code open; always quote it. If a pattern repeats across many files (e.g. the same IDOR mistake in 6 different route handlers), list every location, not just one example — the fix effort estimate and the perceived severity both depend on knowing the true scope.

## Patches vs. descriptions

Prefer an actual diff when the fix is small and mechanical (a missing `WHERE user_id = ?`, a wrong hash function, a missing `await`). Reserve prose-only fixes for cases where the right fix depends on a product/architecture decision the user needs to make (e.g. "should follower lists be public or private" — show the policy options, don't just pick one).

If the user wants the fixes actually applied, not just described, that's a natural next step once the report is delivered — offer it, but don't silently start editing the source while still producing the audit report; finish documenting the finding first so there's a record of what was wrong before it's fixed.
