import type { JSX } from 'react';
import './correlation-visual.css';

/**
 * The correlation chain: an externally observed defect traced down to the
 * exact source symbol that causes it. Four nodes in a descending cascade —
 * a horizontal row cannot hold four monospaced symbol names inside 620px
 * without shrinking them past legibility, and the staircase reads as a call
 * trace, which is what the join actually is.
 *
 * Server component by design: every moving part is CSS, so this ships no
 * client JavaScript. See correlation-visual.css for the motion contract.
 */

type ChainNode = {
  /** Eyebrow rendered above the node. Written uppercase at source rather
   *  than via text-transform, which SVG support for is patchier. */
  readonly kind: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
};

const NODE_H = 34;
const RADIUS = 9;

/** Cascade: 84px right and 58px down per step. Widths are sized to the
 *  monospace advance (~0.6em at 10.5px) plus the dot gutter and padding. */
const NODES: readonly ChainNode[] = [
  { kind: 'OBSERVED', label: 'GET /api/invoices/{id}', x: 16, y: 26, w: 180 },
  { kind: 'ROUTE', label: 'InvoiceController.findOne', x: 100, y: 84, w: 199 },
  { kind: 'SYMBOL', label: 'InvoiceService.find', x: 184, y: 142, w: 161 },
  { kind: 'SOURCE', label: 'invoice.service.ts:17', x: 268, y: 200, w: 174 },
];

/**
 * Orthogonal elbows: down out of the node above, rounded corner, then right
 * into the node below. Each carries pathLength="100" so one set of dash
 * values in CSS drives all three segments identically.
 */
const CONNECTORS: readonly string[] = [
  'M 38 60 V 93 Q 38 101 46 101 H 96',
  'M 122 118 V 151 Q 122 159 130 159 H 180',
  'M 206 176 V 209 Q 206 217 214 217 H 264',
];

/** Arrowheads sit just outside each target node's left edge. */
const ARROWS: readonly string[] = [
  'M 96 97.4 L 101 101 L 96 104.6 Z',
  'M 180 155.4 L 185 159 L 180 162.6 Z',
  'M 264 213.4 L 269 217 L 264 220.6 Z',
];

const TERMINAL = NODES[NODES.length - 1];

const ARIA_LABEL =
  'Correlation chain: the observed request GET /api/invoices/{id} is traced ' +
  'through the route InvoiceController.findOne to the symbol InvoiceService.find, ' +
  'resolving to source at invoice.service.ts line 17.';

export default function CorrelationVisual(): JSX.Element {
  // Guard for strictNullChecks — NODES is a fixed literal, but the indexed
  // access is only provably safe to the compiler with noUncheckedIndexedAccess
  // off, and this keeps the component honest either way.
  const terminalCx = TERMINAL ? TERMINAL.x + TERMINAL.w / 2 : 355;
  const terminalCy = TERMINAL ? TERMINAL.y + NODE_H / 2 : 217;

  return (
    <div className="cv-root">
      <svg
        className="cv-svg"
        viewBox="0 0 620 260"
        role="img"
        aria-label={ARIA_LABEL}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="cv-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path className="cv-grid-line" d="M 24 0 H 0 V 24" />
          </pattern>

          <radialGradient id="cv-fade-grad" cx="42%" cy="46%" r="76%">
            <stop offset="0%" className="cv-fade-in" />
            <stop offset="100%" className="cv-fade-out" />
          </radialGradient>

          <mask id="cv-fade">
            <rect width="620" height="260" fill="url(#cv-fade-grad)" />
          </mask>

          <radialGradient id="cv-halo-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" className="cv-halo-core" />
            <stop offset="45%" className="cv-halo-mid" />
            <stop offset="100%" className="cv-halo-edge" />
          </radialGradient>

          <filter id="cv-soften" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>

        {/* Backdrop: faint grid, vignetted away from the edges. */}
        <rect
          className="cv-grid-fill"
          width="620"
          height="260"
          fill="url(#cv-grid)"
          mask="url(#cv-fade)"
        />

        {/* Soft radial glow behind the terminal node. */}
        <ellipse
          className="cv-halo"
          cx={terminalCx}
          cy={terminalCy}
          rx="150"
          ry="56"
          fill="url(#cv-halo-grad)"
        />

        {/* Connectors: static dotted track, then the travelling pulse. */}
        <g aria-hidden="true">
          {CONNECTORS.map((d, i) => (
            <path key={`track-${i}`} className="cv-track" d={d} pathLength="100" />
          ))}
          {ARROWS.map((d, i) => (
            <path key={`arrow-${i}`} className="cv-arrow" d={d} />
          ))}
          {CONNECTORS.map((d, i) => (
            <path
              key={`glow-${i}`}
              className={`cv-pulse-glow cv-seg-${i + 1}`}
              d={d}
              pathLength="100"
            />
          ))}
          {CONNECTORS.map((d, i) => (
            <path
              key={`pulse-${i}`}
              className={`cv-pulse cv-seg-${i + 1}`}
              d={d}
              pathLength="100"
            />
          ))}
        </g>

        {/* Nodes. */}
        {NODES.map((node, i) => {
          const isTerminal = i === NODES.length - 1;
          return (
            <g
              key={node.label}
              className={`cv-node${isTerminal ? ' cv-node-terminal' : ''}`}
            >
              <text className="cv-kind" x={node.x + 1} y={node.y - 10}>
                {node.kind}
              </text>
              <rect
                className="cv-node-box"
                x={node.x}
                y={node.y}
                width={node.w}
                height={NODE_H}
                rx={RADIUS}
              />
              <rect
                className="cv-node-hi"
                x={node.x}
                y={node.y}
                width={node.w}
                height={NODE_H}
                rx={RADIUS}
              />
              <circle className="cv-node-dot" cx={node.x + 15} cy={node.y + 17} r="2.5" />
              <text className="cv-label" x={node.x + 27} y={node.y + 21}>
                {node.label}
              </text>
            </g>
          );
        })}

        {/* Arrival ring on the terminal dot, in step with the halo. */}
        <circle
          className="cv-ring"
          cx={TERMINAL ? TERMINAL.x + 15 : 283}
          cy={terminalCy}
          r="6.5"
        />

        {/* Verified badge, sitting to the right of the terminal node. */}
        <g className="cv-badge" aria-hidden="true">
          <rect className="cv-badge-box" x="458" y="206" width="88" height="22" rx="11" />
          <path className="cv-badge-check" d="M 470 217.2 L 473 220 L 478.5 214" />
          <text className="cv-badge-text" x="485" y="220.5">
            VERIFIED
          </text>
        </g>
      </svg>
    </div>
  );
}
