# Kase: current system, frontend, and interface assessment

Review started 12 September 2026; finalized 13 September 2026. Audience: product owner, frontend developer, backend developer, QA.

## 1. Where we stand

Kase's system design is substantially more mature than its web interface. The repository contains a deterministic audit foundation, scoped authorization, project configuration, workers, evidence retrieval, findings reads, and endpoint inventory. The web app contains marketing, documentation, brand, invite-only sign-in, and a protected dashboard shell. A person cannot yet onboard a project, run an audit, inspect a finding, or make a release decision through that dashboard.

The visual direction already has a recognizable identity: dark surfaces, mint accents, restrained typography, monospace technical detail, and a correlation illustration. Keep that identity. The next investment should be completing operational workflows and their states, followed by visual verification with real data.

Do not report one percentage for frontend completion. A styled shell, authentication, and a usable evidence workflow have very different delivery value. None of the seven M7 dashboard checklist items in `TASKS.md` is checked at review time.

## 2. Evidence and limits

Reviewed the web route tree, authentication modules, styles, API controllers and relevant services/DTOs, Prisma models, `TASKS.md`, and architecture/API/dashboard documentation. The working tree contains extensive unrelated changes and untracked M4 implementation. This report includes those as in progress and does not certify them as released.

The root README reports M1–M3 verified. That is recorded project evidence, not a rerun of the Docker proofs in this review. M4 acceptance remains unchecked in the task ledger despite substantial source now being present. The correlation spike proves a bounded demonstration; the platform's `CorrelationModule` and `AssuranceModule` are empty module shells.

No listening web server was found on ports 3000–3002 during inspection. No authenticated browser, screenshot, contrast measurement, responsive rendering, accessibility scan, or live backend mutation was performed. Interface conclusions below are code-based. Baseline verification passed: 4 existing authentication test suites / 34 tests, and TypeScript no-emit checking with no diagnostics. These checks do not validate browser workflows. Execution details are recorded in the handoff gates file.

## 3. System capability map

| Capability | Backend/source status | Web status | Implication |
|---|---|---|---|
| Invite-only identity | Auth.js provider validation, invite resolution, RS256 exchange implemented | Sign-in page and session redirect exist | Foundation is usable in source; deployment configuration and invite provisioning still matter |
| Project authorization | Four flat project roles; org membership/admin distinction; per-request membership checks | No role-aware app navigation or permission bootstrap | Role-specific experiences cannot be inferred from the current session object |
| Projects, repositories, targets, scope | CRUD controllers/services implemented | No working setup forms or project browser | First-use activation is blocked at the interface |
| Secrets and project API tokens | Admin-only lifecycle routes | No management screens | Operators still depend on external setup |
| Evidence retention | Organization defaults and project overrides implemented | No settings UI | Administrative configuration remains API-driven |
| Audit execution | Dispatch, jobs, cancellation and persisted SSE implemented | Audits navigation disabled | Existing runtime cannot be operated from the web |
| Findings and evidence | Audit-scoped read routes and authenticated binary evidence download implemented | Findings navigation disabled | Core proof-review experience absent |
| Recon/inventory | Canonical inventory, filters and persisted drift implemented | No endpoint screen | Useful backend output is invisible to browser users |
| AI runtime | M4 providers, configuration, budgets, agent runs and test identities in working tree | No configuration/inspection screens | Treat as conditional pending M4 verification and stable read contracts |
| Platform correlation/lifecycle | Models/design/spike; platform module empty | Illustration only | Do not present the illustration as a real finding trace |
| Gates, waivers, reports | Models/design exist; assurance module empty, no workflow controllers found | Disabled Reports item; no other screens | Backend and frontend delivery required |
| GitHub/Jira | Specified downstream milestones | No settings or issue actions | Cannot promise working PR gate or ticket delivery |

Sources: [task ledger](../../../TASKS.md), [API source](../../../apps/api/src), [schema](../../../packages/db/schema.prisma), [dashboard specification](../README.md).

## 4. Interface findings, prioritized

Priority meanings: P0 blocks the operational-console release; P1 blocks a credible beta or risks incorrect interpretation; P2 is interface refinement.

| Priority | Finding and source | Required action |
|---|---|---|
| P0 | `apps/web/src/app/dashboard/page.tsx:15` — Audits, Findings and Reports have no destinations; no product pages exist behind them | Implement the project/audit/finding/evidence journey before calling the dashboard operational |
| P0 | `apps/web/src/app/dashboard/page.tsx:126` — “Set up first audit” navigates to `/docs` | Replace with permission-aware project creation/setup; keep documentation as a secondary link |
| P0 | `apps/web/src/auth/index.ts` and `apps/api/src/auth/project-scope.guard.ts` — session has user/org IDs, while roles are resolved only inside API authorization | Add a scoped current-user/access contract; enforce authorization server-side and reflect it in UI |
| P1 | `apps/web/src/app/dashboard/page.tsx:27` — hardcoded readiness calls audit runtime “Not started,” while audit/evidence/recon source exists | Remove milestone status from the operational dashboard; show actual project setup and last-audit state |
| P1 | `apps/api/src/projects/projects.service.ts:175` — project list filters by organization, while detail access requires project membership | Agree visibility semantics; recommend accessible-project list plus role/capability metadata. Do not infer authorization from list inclusion |
| P1 | `apps/api/src/findings/findings.service.ts:9` — filters use single exact values; no pagination or specified severity sorting | Add stable server-side pagination/filter/sort before offering the complete findings workspace |
| P1 | `apps/web/src/app/signin/page.tsx:61` — sign-in callback redirects to `/`, adding a marketing-page detour | Redirect to validated return path or `/dashboard`; preserve deep-link intent |
| P1 | `apps/web/src/app/signin/page.tsx:52` — no-provider error exposes environment variable setup to invitees | Give invitees a support/retry explanation; retain technical configuration detail in operations docs/logging |
| P1 | `apps/web/package.json` — tests target auth `.spec.ts`; no product E2E or browser accessibility suite found | Add critical workflow, role-denial, keyboard, stale-data and evidence-state coverage as screens ship |
| P2 | `apps/web/src/app/layout.tsx:19` — skip target wraps navigation as well as main content | Move the target onto each page's main landmark and verify keyboard focus actually bypasses navigation |
| P2 | `apps/web/src/app/marketing-client.tsx:50` — intake type selector lacks `name` | Add a meaningful name; current JS sends the state explicitly, so this is a form semantics issue, not evidence of failed submission |
| P2 | `apps/web/src/app/globals.css` and dashboard styles — global marketing and dashboard selectors share cascade and layering | Scope product components/styles so future dense screens do not inherit marketing layout assumptions |

Line references are snapshot navigation aids; re-resolve after source edits. General interface checklist consulted: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). This is not a claim of WCAG conformance.

## 5. What is worth preserving

- Clear separation between AI interpretation and deterministic records in the product definition.
- Invite-only authentication and verified-email handling; project membership is re-read rather than trusting a stale role in a token.
- Semantic navigation, explicit disabled “Soon” items, a global focus-visible rule, labeled intake controls, live submission feedback, and reduced-motion rules.
- A server-rendered correlation illustration that explains the product without shipping a large client visualization framework.
- A design specification that already makes degraded execution, provenance, evidence, advisory status and passing checks prominent.

These are source observations, not proof of keyboard, screen-reader, contrast or performance results.

## 6. Contract drift and decisions

1. **Roles are flat.** Admin does not universally inherit operator or approver. Current audit start/cancel endpoints explicitly allow both operator and admin. Future approval routes should require approver explicitly.
2. **Organization administration exists.** The API README's “no organization-level role” statement is outdated relative to `OrganizationMember` and `OrganizationAdminGuard`. Organization admin and project admin are separate grants.
3. **Lists differ.** Projects return a page envelope; audits return a bare array capped at 100; findings/evidence return bare arrays; M4 reads use `{ data }`. A universal `response.data` assumption will break the app.
4. **Audit create examples differ.** Current DTO uses `maxWallTimeMs`, not the documented `budgetOverrides`; it does not accept `routeMap`. Unknown fields are rejected by the global validation pipe.
5. **No browser role/bootstrap API found.** No membership-management or invitation HTTP controllers were found either. Invite acceptance code and DB models do not make an administration workflow complete.
6. **No current public model catalog endpoint found.** A model picker needs a supported catalog contract; never embed presumed model availability or pricing.
7. **SSE needs an authentication design.** Native EventSource cannot attach a bearer header. Current Next configuration has no API rewrite/proxy, and API bootstrap does not enable browser CORS. Specify a same-origin server bridge rather than letting each screen invent transport.
8. **Outcome distinctions are essential.** Audit completion is not a gate pass. Missing evaluation is not PASS, and PARTIAL is never PASS.

## 7. Delivery recommendation

**Operational console first:** current-user capabilities, app shell, project onboarding/settings, audit dispatch/progress/cancel, findings/evidence, inventory, and role-aware credential/retention screens. Provide honest “not evaluated” release status until assurance exists.

**Release assurance next:** stable correlation and lifecycle contracts, gate explanations, waiver request/approval, suppression management, reports, GitHub/Jira integration, and audit trail reads. These are explicit backend dependencies, not tasks the frontend developer can solve with UI state.

Acceptance should be a real user's completed journey: an invited team onboards a non-fixture target, runs an authorized audit, understands its coverage and limitations, inspects evidence, and, once assurance ships, sees a reproducible release decision. Decorative dashboard polish alone does not meet that bar.


