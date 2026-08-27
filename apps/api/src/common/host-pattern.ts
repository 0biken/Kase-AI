/**
 * Scope-policy host patterns.
 *
 * 17-security §3: "Host must match `allowedHosts` — Exact or single-label
 * wildcard. Bare TLDs and `*` rejected **at policy creation**."
 *
 * Creation-time rejection is the point. A pattern like `*` or `*.com` that is
 * only caught when a worker is already running has, by then, been written into
 * a policy a human attested to. The attestation says "I am authorized to test
 * this"; it is worthless if the policy it attests to means "the internet".
 */

/**
 * Suffixes under which a wildcard would span unrelated registrants.
 *
 * `*.co.uk` is three labels, so a naive label count accepts it while it in fact
 * matches every .co.uk domain — exactly the bare-TLD case the rule forbids.
 * This list is pragmatic, not exhaustive: the correct fix is the Public Suffix
 * List, which is a dependency and a periodic data update. Tracked as a
 * follow-up; until then this covers the common multi-part suffixes and the
 * label-count rule below catches every single-part TLD.
 */
const MULTIPART_SUFFIXES = [
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.mx', 'com.ar', 'com.sg', 'com.hk', 'com.tw', 'com.tr',
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'herokuapp.com',
  'pages.dev', 'workers.dev', 'azurewebsites.net', 'cloudfront.net',
];

/** Hosts that are meaningful with a single label, per "explicitly local". */
const ALLOWED_SINGLE_LABEL = ['localhost'];

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type HostPatternRejection =
  | 'empty'
  | 'not_lowercase'
  | 'contains_scheme'
  | 'contains_path'
  | 'contains_port'
  | 'contains_credentials'
  | 'invalid_label'
  | 'wildcard_alone'
  | 'wildcard_not_leftmost'
  | 'multiple_wildcards'
  | 'wildcard_on_public_suffix'
  | 'bare_tld'
  | 'ip_address';

export interface HostPatternResult {
  valid: boolean;
  reason?: HostPatternRejection;
  detail?: string;
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validates one `allowedHosts` entry.
 *
 * Accepts an exact host (`staging.acme.com`, `localhost`) or a single leftmost
 * wildcard (`*.staging.acme.com`). Everything else is rejected with a reason,
 * so the API can say which entry failed and why rather than "invalid policy".
 */
export function validateHostPattern(raw: string): HostPatternResult {
  const fail = (reason: HostPatternRejection, detail: string): HostPatternResult => ({
    valid: false,
    reason,
    detail,
  });

  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail('empty', 'Host pattern must be a non-empty string');
  }

  const host = raw.trim();

  if (host !== host.toLowerCase()) {
    // Rejected rather than normalised: silently lowercasing means the stored
    // policy differs from the attested text.
    return fail('not_lowercase', `"${host}" must be lowercase`);
  }
  if (host.includes('://')) {
    return fail('contains_scheme', `"${host}" must be a bare host, not a URL`);
  }
  if (host.includes('@')) {
    return fail('contains_credentials', `"${host}" must not contain credentials`);
  }
  if (host.includes('/')) {
    return fail('contains_path', `"${host}" must be a bare host, without a path`);
  }
  if (host.includes(':')) {
    // A port here is ambiguous: does the policy cover other ports on the same
    // host? Rather than guess, require the host alone.
    return fail('contains_port', `"${host}" must not include a port`);
  }

  if (host === '*') {
    return fail('wildcard_alone', '"*" would allow every host on the internet');
  }

  const labels = host.split('.');
  const wildcardCount = labels.filter((l) => l === '*').length;

  if (wildcardCount > 1) {
    return fail('multiple_wildcards', `"${host}" may contain at most one wildcard`);
  }
  if (wildcardCount === 1 && labels[0] !== '*') {
    return fail(
      'wildcard_not_leftmost',
      `"${host}" may only use a wildcard as the leftmost label`,
    );
  }

  // Any label that is not the leading wildcard must be a valid DNS label.
  for (const label of wildcardCount === 1 ? labels.slice(1) : labels) {
    if (label.includes('*')) {
      return fail('wildcard_not_leftmost', `"${host}" has a wildcard inside a label`);
    }
    if (!LABEL_RE.test(label)) {
      return fail('invalid_label', `"${host}" contains an invalid DNS label: "${label}"`);
    }
  }

  if (wildcardCount === 0) {
    if (IPV4_RE.test(host)) {
      // Scope is expressed as hosts; an IP bypasses DNS-name reasoning and the
      // private-range rule in §3. Explicitly out of scope for v1 policies.
      return fail('ip_address', `"${host}" is an IP address; specify a hostname`);
    }
    if (labels.length === 1) {
      if (ALLOWED_SINGLE_LABEL.includes(host)) return { valid: true };
      return fail('bare_tld', `"${host}" is a single label; specify a fully qualified host`);
    }
    return { valid: true };
  }

  // Wildcard case: the part after "*." must itself be a registrable domain,
  // not a public suffix.
  const suffix = labels.slice(1).join('.');

  if (MULTIPART_SUFFIXES.includes(suffix)) {
    return fail(
      'wildcard_on_public_suffix',
      `"${host}" would match every domain under "${suffix}"`,
    );
  }
  if (labels.length < 3) {
    // "*.com" — two labels — spans an entire TLD.
    return fail('bare_tld', `"${host}" would match every domain under "${suffix}"`);
  }

  return { valid: true };
}

/**
 * Validates a whole `allowedHosts` array, returning every failure rather than
 * the first — an operator fixing a policy should see all the problems at once.
 */
export function validateAllowedHosts(hosts: string[]): {
  valid: boolean;
  errors: string[];
} {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return { valid: false, errors: ['allowedHosts must contain at least one host'] };
  }

  const errors: string[] = [];
  const seen = new Set<string>();

  for (const h of hosts) {
    const result = validateHostPattern(h);
    if (!result.valid) {
      errors.push(result.detail ?? `Invalid host pattern: ${h}`);
      continue;
    }
    const key = String(h).trim();
    if (seen.has(key)) errors.push(`Duplicate host pattern: "${key}"`);
    seen.add(key);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Whether a concrete host is covered by a validated pattern.
 *
 * Single-label wildcard: `*.acme.com` covers `api.acme.com` but NOT
 * `a.b.acme.com` (two labels) and not the apex `acme.com`. Callers wanting the
 * apex must list it separately — which is deliberate, since "and the apex too"
 * is an assumption worth making explicit in an attested policy.
 */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();

  if (!p.startsWith('*.')) return h === p;

  const suffix = p.slice(2);
  if (!h.endsWith(`.${suffix}`)) return false;

  const prefix = h.slice(0, h.length - suffix.length - 1);
  return prefix.length > 0 && !prefix.includes('.');
}

/** Whether any pattern in the policy covers `host`. */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((p) => hostMatchesPattern(host, p));
}
