import { Project, SyntaxKind, MethodDeclaration } from 'ts-morph';
import * as crypto from 'crypto';
import * as path from 'path';
import { Finding, Evidence } from './types';

/**
 * Stand-in for the Semgrep adapter.
 *
 * The real system runs Semgrep (docs/07 §4.8). Semgrep is a Python tool and
 * is not installed here, so this implements one equivalent rule directly on
 * the AST. It deliberately emits the SAME FIELDS a Semgrep finding would —
 * ruleId, cwe, file, line, and an enclosing symbol resolved from the AST
 * rather than a bare line number — because those fields are what the join
 * and the fingerprint consume.
 *
 * What this does NOT prove: Semgrep's rule coverage or accuracy. That was
 * never the uncertain part. What it does prove is that a SAST-shaped finding
 * carrying an enclosing symbol joins cleanly to a route-derived source
 * location, which is the thing the spike exists to test.
 *
 * RULE kase.idor.missing-ownership-predicate (CWE-639)
 *
 * Fires when a Prisma read inside a method that receives a requester/owner
 * identifier filters by record id alone, never constraining on the caller.
 */
const RULE_ID = 'kase.idor.missing-ownership-predicate';
const CWE = 'CWE-639';

const OWNER_PARAM_HINTS = ['requesterid', 'userid', 'ownerid', 'currentuserid', 'actorid'];
const OWNERSHIP_FIELD_HINTS = ['ownerid', 'userid', 'accountid', 'tenantid', 'organizationid'];
const PRISMA_READS = ['findUnique', 'findFirst', 'findMany'];

export function runSast(tsConfigFilePath: string): Finding[] {
  const project = new Project({ tsConfigFilePath });
  const root = path.dirname(tsConfigFilePath);
  const findings: Finding[] = [];

  for (const sf of project.getSourceFiles()) {
    const relFile = path.relative(root, sf.getFilePath()).split(path.sep).join('/');
    if (relFile.includes('node_modules')) continue;

    for (const cls of sf.getClasses()) {
      for (const method of cls.getMethods()) {
        const ownerParam = findOwnerParam(method);
        if (!ownerParam) continue;

        for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const callee = call.getExpression();
          if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;
          if (!PRISMA_READS.includes(callee.getName())) continue;

          const whereFields = extractWhereFields(call);
          if (whereFields === null) continue;

          const constrainsOwnership = whereFields.some((f) =>
            OWNERSHIP_FIELD_HINTS.includes(f.toLowerCase()),
          );
          if (constrainsOwnership) continue;

          const enclosingSymbol = `${cls.getName()}.${method.getName()}`;
          const line = call.getStartLineNumber();
          const excerpt = call.getText();

          findings.push({
            id: `WB-${shortHash(`${relFile}:${enclosingSymbol}:${RULE_ID}`)}`,
            origin: 'whitebox',
            tool: 'semgrep-equivalent',
            ruleId: RULE_ID,
            category: 'authorization',
            cwe: CWE,
            title: 'Resource lookup lacks an ownership predicate',
            severityProposed: 'critical',
            affectedTarget: null,
            sourceLocations: [{ file: relFile, enclosingSymbol, line }],
            evidence: [sastEvidence(relFile, enclosingSymbol, line, excerpt, ownerParam, whereFields)],
            description:
              `\`${enclosingSymbol}\` accepts \`${ownerParam}\` but queries on ` +
              `{ ${whereFields.join(', ')} } only. The caller identity never reaches the ` +
              `query predicate, so any authenticated caller can read any record by id.`,
          });
        }
      }
    }
  }

  return findings;
}

function findOwnerParam(method: MethodDeclaration): string | null {
  for (const p of method.getParameters()) {
    if (OWNER_PARAM_HINTS.includes(p.getName().toLowerCase())) return p.getName();
  }
  return null;
}

/** Returns the property names inside `{ where: { ... } }`, or null if absent. */
function extractWhereFields(call: import('ts-morph').CallExpression): string[] | null {
  const arg = call.getArguments()[0];
  if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) return null;

  const whereProp = arg.getProperty('where');
  if (!whereProp || !whereProp.isKind(SyntaxKind.PropertyAssignment)) return null;

  const initializer = whereProp.getInitializer();
  if (!initializer || !initializer.isKind(SyntaxKind.ObjectLiteralExpression)) return null;

  return initializer
    .getProperties()
    .map((p) => {
      if (p.isKind(SyntaxKind.PropertyAssignment)) return p.getName();
      if (p.isKind(SyntaxKind.ShorthandPropertyAssignment)) return p.getName();
      return null;
    })
    .filter((n): n is string => n !== null);
}

function sastEvidence(
  file: string,
  symbol: string,
  line: number,
  excerpt: string,
  ownerParam: string,
  whereFields: string[],
): Evidence {
  const payload = {
    ruleId: RULE_ID,
    cwe: CWE,
    file,
    enclosingSymbol: symbol,
    line,
    excerpt,
    ownerParamAvailable: ownerParam,
    queryConstrainedOn: whereFields,
  };
  return {
    id: `EV-${shortHash(JSON.stringify(payload))}`,
    tool: 'semgrep-equivalent',
    type: 'sast_json',
    // Rule + file + symbol is re-derivable from source: replayable, gate-eligible.
    evidenceClass: 'replayable',
    sha256: sha256(JSON.stringify(payload)),
    payload,
  };
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function shortHash(input: string): string {
  return sha256(input).slice(0, 8);
}
