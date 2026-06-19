import type { Chart, ChartPoint } from '@evidata/answer-contract';

/**
 * Inline, dependency-free chart for an Answer (issue #67). Hand-rolled SVG so the
 * bundle stays lean and theming flows through the CSS design tokens (globals.css).
 * Bar and line only — the highest-value enrichment; `table`/`comparison` kinds fall
 * back to the visually-hidden data table the chart already renders for a11y.
 *
 * Accessibility: the <svg> is `role="img"` with a summarizing aria-label, and a
 * visually-hidden <table> carries the exact figures so screen readers (and the
 * WCAG-AA smoke matrix) get the data, not just decorative bars. Colors come from
 * tokens that already pass AA in both themes, so the chart adds no new violations.
 */

const VIEW_W = 320;
const VIEW_H = 160;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 22; // room for x-axis category labels

/** Keep only finite-valued points; a producer should pre-clean, but never trust NaN/Infinity. */
function finitePoints(points: readonly ChartPoint[]): ChartPoint[] {
  return points.filter((p) => Number.isFinite(p.value));
}

/** Compact axis/summary number, e.g. 48200 → "48.2k". */
function fmt(n: number): string {
  if (Math.abs(n) >= 1000)
    return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString();
}

function summarize(chart: Chart, points: readonly ChartPoint[]): string {
  const kind = chart.kind === 'line' ? 'Line chart' : 'Bar chart';
  const title = chart.spec.title ? `: ${chart.spec.title}` : '';
  const series = points.map((p) => `${p.label} ${fmt(p.value)}`).join(', ');
  return `${kind}${title}. ${series}.`;
}

export function AnswerChart({ chart }: { chart: Chart }) {
  const points = finitePoints(chart.spec.points);
  if (points.length === 0) return null;

  const max = Math.max(...points.map((p) => p.value), 0);
  const min = Math.min(...points.map((p) => p.value), 0);
  const span = max - min || 1; // avoid divide-by-zero on a flat series
  const plotW = VIEW_W - PAD_X * 2;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const baseY = PAD_TOP + plotH;

  // Map a value to a y within the plot; a category index to its band center x.
  const yOf = (v: number): number => baseY - ((v - min) / span) * plotH;
  const bandW = plotW / points.length;
  const cx = (i: number): number => PAD_X + bandW * i + bandW / 2;

  const summary = summarize(chart, points);

  return (
    <figure className="m-0 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      {chart.spec.title && (
        <figcaption className="text-xs font-medium text-muted-foreground">
          {chart.spec.title}
        </figcaption>
      )}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={summary}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Zero/baseline axis. */}
        <line
          x1={PAD_X}
          y1={yOf(0)}
          x2={VIEW_W - PAD_X}
          y2={yOf(0)}
          stroke="var(--border)"
          strokeWidth={1}
        />

        {chart.kind === 'line' ? (
          <>
            <polyline
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points.map((p, i) => `${cx(i)},${yOf(p.value)}`).join(' ')}
            />
            {points.map((p, i) => (
              <circle key={i} cx={cx(i)} cy={yOf(p.value)} r={3} fill="var(--primary)" />
            ))}
          </>
        ) : (
          points.map((p, i) => {
            const barW = Math.max(bandW * 0.6, 1);
            const top = yOf(Math.max(p.value, 0));
            const bottom = yOf(Math.min(p.value, 0));
            return (
              <rect
                key={i}
                x={cx(i) - barW / 2}
                y={top}
                width={barW}
                height={Math.max(bottom - top, 1)}
                rx={2}
                fill="var(--primary)"
              />
            );
          })
        )}

        {/* x-axis category labels (chrome, not the accessible source of truth). */}
        {points.map((p, i) => (
          <text
            key={i}
            x={cx(i)}
            y={VIEW_H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted-foreground)"
          >
            {p.label}
          </text>
        ))}
      </svg>

      {/* Visually-hidden table fallback: the exact figures for assistive tech. */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{chart.spec.xLabel ?? 'Category'}</th>
            <th scope="col">{chart.spec.yLabel ?? 'Value'}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{p.value.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
