# Test Categories

Pick the categories relevant to scope. Each section lists what to actually check and, where useful, the concrete command/tool pattern. This list is drawn from a real 17-category audit — treat it as a menu, not a mandatory checklist for every engagement.

## Reconnaissance (always do this first)

- DNS records (`dig`/`nslookup`), subdomain enumeration via certificate transparency logs (`crt.sh/?q=%.domain.com&output=json`)
- TLS posture: `openssl s_client -connect host:443` — protocol versions enabled, cert chain, expiry
- HTTP response headers on every discovered host (`curl -I`)
- `robots.txt`, `sitemap.xml`, `.well-known/security.txt`, `humans.txt`, `ads.txt`
- Route discovery: crawl linked pages, check JS bundle for additional route strings, check `sitemap.xml`
- JS bundle scan for embedded secrets/keys (`curl` the bundle, grep for `key`, `secret`, `token`, `sk_live`, etc.) and for stack fingerprinting (`X-Powered-By`, framework-specific headers/paths)
- Tech stack identification: framework, hosting, CDN, backend (look for parallel/legacy backends — a common finding is two APIs serving the same data with inconsistent auth)

## Security

OWASP Web Security Testing Guide-aligned. Core checks:

- **HTTP security headers:** HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy. Missing headers = High severity collectively.
- **CORS:** check `Access-Control-Allow-Origin` on every API host — `*` combined with credentialed/token-bearing requests is High.
- **Database/backend access control:** if a BaaS (Supabase/Firebase) is in use, directly query tables with the anon/public key and see what comes back. This is often where the most severe findings live — RLS/security-rules misconfiguration silently exposes full tables.
- **Authentication bypass:** test any gate/paywall/beta-access mechanism for static tokens or predictable cookies that can be set manually rather than earned through the actual auth flow.
- **Admin panel / infra exposure:** check for publicly reachable deployment panels, staging environments, or internal tools (often on predictable subdomains like `admin.`, `staging.`, `dashboard.`, deploy-tool-specific subdomains).
- **Open redirects:** test `?next=`, `?redirect=`, `?return_url=` params.
- **Source maps/secrets in bundle:** confirm `.js.map` files 404, scan bundle for hardcoded secrets.
- **Email infra:** SPF/DKIM/DMARC presence (`dig TXT domain.com`, `dig TXT _dmarc.domain.com`).

## Authentication & Authorization (deeper than basic security)

- Session/token mechanism: cookie vs JWT, expiry, refresh flow, HttpOnly/Secure/SameSite flags
- **IDOR testing (requires 2 test accounts):** As User1, request User2's resources by ID/slug. Try GET, PATCH, DELETE on objects you don't own — confirm each is blocked, not just GET.
- Privilege escalation: can a regular user access admin-only fields or routes by direct request even if the UI hides them?
- Rate limiting on login/signup (brute-force protection), CAPTCHA presence on open signup
- Password reset flow: token entropy, expiry, whether the token is invalidated after use

## API Surface

- Enumerate all backends in play (sometimes more than one — flag if old/dev APIs are still live and serving real data)
- For each endpoint: auth requirement, response shape, whether it leaks more fields than the UI displays
- CORS per-backend (see Security)
- Rate limiting presence
- Versioning and deprecated-endpoint exposure

## Content Safety

- XSS surface: any user-generated content rendered without sanitization (test with a script-tag bearing test post if a test account is authorized)
- File upload pipeline: type validation, size limits, whether uploaded files are served from a sandboxed domain
- Link preview / unfurl mechanisms: SSRF risk if the server fetches arbitrary user-supplied URLs

## Performance

- Run Lighthouse (CLI: `npx lighthouse <url> --output=json --output=html --chrome-flags="--headless"`) on key pages, both prod and any beta/staging environment for comparison
- Core Web Vitals: LCP, CLS, TBT/INP
- Bundle size analysis — flag uncompressed JS/CSS, missing Brotli/gzip
- Caching headers (`Cache-Control`, `ETag`) on static assets
- TTFB on key routes, especially anything server-rendered

## Accessibility

WCAG 2.2 AA as the baseline standard. Use Playwright + axe-core:

```javascript
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
const results = await new AxeBuilder({ page }).analyze();
console.log(JSON.stringify(results.violations, null, 2));
```

Cross-reference axe violations with Lighthouse's accessibility score. Check color contrast in both light AND dark mode if the app supports theming — contrast bugs are often theme-specific. Check keyboard navigation and focus order manually for at least the primary user flow.

## SEO & Best Practices

- Meta tags (title, description, OG tags, Twitter cards) on key pages
- `robots.txt` and `sitemap.xml` presence and correctness
- Structured data (JSON-LD) where applicable
- Canonical URLs, no duplicate-content traps

## UX & Cross-Platform

Use Playwright to screenshot key routes across viewport × theme combinations (e.g. desktop/mobile × light/dark):

```javascript
const viewports = [{width:1440,height:900,name:'desktop'}, {width:390,height:844,name:'mobile'}];
const themes = ['light', 'dark'];
// for each route × viewport × theme: navigate, set theme (localStorage or toggle), screenshot
```

Check for: layout overflow on mobile, broken responsive breakpoints, theme-specific bugs, browser-specific rendering issues if multiple engines are available.

## Social/Platform-Specific Risks

For any app with user-generated content or social features: abuse vectors (spam, harassment, ban-evasion), moderation tooling gaps, content reporting flow, blocked/muted user enforcement.

## Observability

- Client-side error tracking presence (Sentry, etc. — check bundle for DSN/init calls)
- Server logging — ask the client what's logged, since this usually can't be black-box tested
- Alerting on critical paths (signup, payment, core action)

## Functional Edge Cases

- Unicode/emoji handling in user input fields
- Large request bodies — does the edge/proxy enforce a size limit (expect 413, flag if it returns a generic 502 instead)
- Unusual HTTP methods (TRACE, CONNECT) — should be rejected cleanly (405), not error oddly (500)
- Host header validation — send a request with an unexpected `Host` header and see if it's accepted (cache poisoning / reset-link manipulation risk if so)
- SQL/NoSQL injection probes on any field that reaches a query layer directly

## Network Resilience

Use Chrome DevTools Protocol network throttling presets (via Playwright) to test the same key pages under: broadband, fast 4G, slow 4G, slow 3G, and fully offline. Record TTFB and full-load time at each tier, and check whether there's a meaningful offline fallback (service worker) vs. a raw browser error.

## Load Testing

Use k6. **Always start with a light run before a heavy one**, and confirm with the user before pointing a heavy run at a production environment serving real users — prefer staging if available.

```javascript
import http from 'k6/http';
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 200 },
    // continue ramping only if the prior stage held up
  ],
};
export default function () {
  http.get('https://target/key-route');
}
```

Report: error rate and timeout count at each VU milestone, the approximate breaking point (where error rate crosses ~50%), and what the dominant failure mode is (timeouts vs. 5xx vs. TLS errors) — this tells you whether the bottleneck is the app server, the database, or the network layer. Translate VU counts into a realistic narrative for the client ("a single viral post could exceed this capacity") rather than leaving it as raw numbers.

## Beta vs. Production Delta (if multiple environments exist)

A dedicated comparison report is valuable when prod is a stub/landing page and beta/staging holds the real app, or when there's drift between environments that could cause launch-day surprises. List every difference that matters: feature availability, security posture, performance, and a consolidated launch-blocker list pulled from all categories.
