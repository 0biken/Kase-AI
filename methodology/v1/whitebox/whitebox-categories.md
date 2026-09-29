# White-Box Audit Categories

Pick categories relevant to scope. Each lists what to check and concrete tool/grep patterns. Unlike black-box recon, the equivalent first step here is building a **code map** — do this before anything else.

## Code Map (always do this first)

- Entry points: main server file, route definitions, CLI entry, build config
- Framework/language identification from lockfiles (`package.json`, `requirements.txt`, `Gemfile`, `go.mod`, `Cargo.toml`)
- Data layer: ORM/query builder in use, raw SQL presence, migration files (these reveal the real schema — more reliable than guessing from black-box probing)
- Auth/authz: locate middleware, session handling, permission checks — note the pattern used (RBAC, ABAC, ad-hoc role checks) so later findings can reference it consistently
- Third-party integrations: payment, email, storage, analytics SDKs — note where API keys are read from (env vars vs hardcoded — hardcoded is an immediate finding)
- Directory structure conventions (monorepo packages, feature-based vs layer-based organization) — informs how to scope a partial review if the user only wants one module

## Static Security Analysis

- **Injection:** grep for raw SQL string concatenation/interpolation (`+ userInput`, f-strings/template literals building queries), `eval()`, `exec()`, shell command construction from user input, unsafe deserialization (`pickle.loads`, `yaml.load` without `SafeLoader`, etc.)
- **XSS:** look for `dangerouslySetInnerHTML`, `innerHTML =`, `v-html`, unsanitized template rendering of user content
- **Path traversal:** file operations using user-supplied paths without normalization/allowlisting
- **SSRF:** server-side fetches of user-supplied URLs without validation (link previews, webhooks, image proxies)
- Run a SAST tool if the stack supports it:
  ```bash
  pip install semgrep --break-system-packages && semgrep --config=auto /path/to/project
  ```
  For Python specifically: `pip install bandit --break-system-packages && bandit -r /path/to/project`

## Secrets in Source

```bash
grep -rEn "(api[_-]?key|secret|password|token|aws_access|private_key)\s*[:=]\s*['\"][A-Za-z0-9+/_-]{16,}" \
  --include="*.py" --include="*.js" --include="*.ts" --include="*.env*" --include="*.yml" --include="*.json" \
  /path/to/project | grep -v node_modules
```
Also check `.git/` history if the repo is a clone (not a fresh upload) for secrets committed and later removed — they're often still in history:
```bash
git log --all -p | grep -E "(api[_-]?key|secret)\s*[:=]" | head -50
```
Flag any `.env` file committed to the repo (even with placeholder values) as a process finding — it signals the pattern is normalized and real secrets may follow the same path in a future commit.

## Dependency Vulnerabilities

Match to the package manager present:
```bash
npm audit --json                          # Node
pip install pip-audit --break-system-packages && pip-audit   # Python
```
Flag: known-CVE packages, severely outdated major versions of security-relevant libraries (auth, crypto, serialization), and any dependency pulled from a non-standard/unpinned source (git URLs without a commit hash, `*` version ranges on security-sensitive packages).

## Authentication & Authorization Logic

This is where white-box review earns its keep — black-box can only test the paths it thinks to try, but here you can read every authz check directly.

- Find every route/endpoint and verify each one that should require auth actually has the check applied — not just at the router level but enforced in the handler (a common bug: middleware applied inconsistently, or a check present but on the wrong condition)
- Look for **IDOR at the code level**: does the query filter by the requesting user's ID, or only by the requested resource ID? (`WHERE id = :resourceId` without `AND user_id = :currentUser` is the bug pattern)
- Password handling: hashing algorithm (must be bcrypt/argon2/scrypt — flag MD5/SHA1/plaintext immediately as Critical), reset token generation (must be cryptographically random, not predictable/sequential)
- JWT handling: verify signature validation isn't skipped, algorithm isn't accepted as `none`, expiry is enforced, secret isn't hardcoded or trivially guessable
- Role/permission checks: look for places a role check exists in the UI/frontend only with no server-side enforcement of the same rule

## Input Validation & Error Handling

- Check whether validation happens at the boundary (request entry) consistently, or is scattered/inconsistent across handlers
- Error responses: do they leak stack traces, internal paths, or query details to the client in production? Check for `NODE_ENV`/`DEBUG` conditionals around error detail — and verify they're actually wired to the right environment variable
- Unhandled promise rejections / unhandled exceptions that could crash the process (especially Node — an uncaught error in one request handler taking down the whole server is a common production incident)

## Code Quality & Maintainability

Use linters/type-checkers already configured in the project if present (`eslint`, `pylint`, `mypy`, `tsc --noEmit`) — running the project's own configured tooling surfaces issues the team already cares about, rather than imposing an opinion:
```bash
npx eslint . --format json   # if eslint config present
npx tsc --noEmit             # if TypeScript
```
Note (don't necessarily file as "findings" unless severe): significant code duplication, god-files/god-functions, missing error boundaries, inconsistent patterns for the same concern (e.g. three different ways of making API calls in the same codebase).

## Test Coverage

```bash
# run the project's own test suite read-only, don't write new test infra unless asked
npm test -- --coverage   # or equivalent for the stack
```
Flag: critical paths (auth, payment, data mutation) with no test coverage at all — this is a real audit finding (untested code that handles money or auth is a launch risk), not just a nice-to-have.

## Infrastructure-as-Code (if present)

Dockerfiles, docker-compose, Terraform, Kubernetes manifests, CI workflow files:
- Containers running as root unnecessarily
- Secrets passed as plain build args (visible in image history) instead of build secrets/runtime env
- Overly permissive IAM/security-group definitions in Terraform
- CI workflows that echo secrets to logs, or that run on `pull_request_target` with untrusted code checkout (a real supply-chain risk in GitHub Actions)

## License & Compliance (lightweight, only if asked)

Check `package.json`/`requirements.txt` for dependencies with licenses incompatible with the project's stated license (e.g. GPL dependency in a closed-source commercial product) — only worth a dedicated pass if the user specifically cares about this; otherwise skip.
