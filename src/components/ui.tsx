import type { Pace } from '@/lib/finance';
import { formatMoney } from '@/lib/money';

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <p className="flash error" role="alert">{error}</p>;
  if (ok) return <p className="flash ok" role="status">{ok}</p>;
  return null;
}

export function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const cls = signed ? (value < 0 ? 'neg' : value > 0 ? 'pos' : '') : '';
  const text = signed && value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
  return <span className={`num ${cls}`}>{text}</span>;
}

export function Bar({ value, max, pace = 'ok' }: { value: number; max: number; pace?: Pace }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const cls = pace === 'over' ? 'over' : pace === 'ahead' ? 'ahead' : '';
  return (
    <div className={`bar ${cls}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PaceBadge({ pace }: { pace: Pace }) {
  if (pace === 'over') return <span className="pill over">Over budget</span>;
  if (pace === 'ahead') return <span className="pill ahead">Ahead of pace</span>;
  if (pace === 'ok') return <span className="pill">On track</span>;
  return null;
}

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
