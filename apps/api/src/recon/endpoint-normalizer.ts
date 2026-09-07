import type { CanonicalEndpoint } from './recon.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const HEX = /^[0-9a-f]{16,}$/iu;
const BASE64ISH = /^(?=.{20,}$)[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*$/u;

export function normalizeEndpoint(rawUrl: string, rawMethod = 'GET'): CanonicalEndpoint {
  const url = new URL(rawUrl);
  const method = normalizeMethod(rawMethod);
  const segments = collapseSlashes(url.pathname).split('/').map((segment) => {
    if (!segment) return segment;
    const decoded = safeDecode(segment);
    return isIdentifier(decoded) ? '{id}' : encodeURIComponent(decoded).replace(/%7B/giu, '{').replace(/%7D/giu, '}');
  });
  let pathTemplate = segments.join('/');
  if (pathTemplate.length > 1) pathTemplate = pathTemplate.replace(/\/+$/u, '');
  const names = [...new Set([...url.searchParams.keys()])].sort();
  let examplePath = collapseSlashes(url.pathname || '/');
  if (examplePath.length > 1) examplePath = examplePath.replace(/\/+$/u, '');
  return {
    method,
    pathTemplate: pathTemplate || '/',
    parameters: names.map((name) => ({ name, in: 'query' as const, type: 'string' as const })),
    rawExample: `${url.protocol}//${url.host}${examplePath}${names.length ? `?${names.map((name) => `${encodeURIComponent(name)}=`).join('&')}` : ''}`,
  };
}

export function endpointKey(method: string, pathTemplate: string): string {
  return `${normalizeMethod(method)} ${pathTemplate}`;
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase() || 'GET';
  if (!/^[A-Z]+$/u.test(method) || method.length > 16) throw new Error(`Invalid HTTP method: ${value}`);
  return method;
}

function collapseSlashes(path: string): string {
  return path.replace(/\/{2,}/gu, '/');
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function isIdentifier(value: string): boolean {
  return /^\d+$/u.test(value) || UUID.test(value) || ULID.test(value) || HEX.test(value) || BASE64ISH.test(value);
}
