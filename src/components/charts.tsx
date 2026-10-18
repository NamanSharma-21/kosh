import { formatMoney } from '@/lib/money';

/** Income vs spend bars for the last few months. Plain SVG, no chart library. */
export function TrendChart({ data }: { data: { month: string; income: number; spent: number }[] }) {
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spent]));
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(26, slot / 2 - 4);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const label = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and spending by month">
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.month}>
              <rect className="in" x={cx - bw - 2} y={y(d.income)} width={bw} height={H - pad.b - y(d.income)} rx="3">
                <title>{`${label(d.month)} income ${formatMoney(d.income)}`}</title>
              </rect>
              <rect className="out" x={cx + 2} y={y(d.spent)} width={bw} height={H - pad.b - y(d.spent)} rx="3">
                <title>{`${label(d.month)} spent ${formatMoney(d.spent)}`}</title>
              </rect>
              <text x={cx} y={H - 6} textAnchor="middle">{label(d.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><span className="dot" style={{ background: 'var(--accent)' }} />Income</span>
        <span><span className="dot" style={{ background: 'var(--warn)' }} />Spent</span>
      </div>
    </div>
  );
}
