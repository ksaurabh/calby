import { useMemo, useState } from 'react';

export interface DailyCost {
  date: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// Single series, so one hue carries the whole chart and no legend is needed —
// the heading names it. Blue is slot 1 of the validated categorical palette.
const SERIES = '#2a78d6';
const SERIES_HOVER = '#1f5fae';

const money = (usd: number) =>
  usd >= 1 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : '$0';

function labelFor(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Fill in the days with no spend, so gaps read as zero rather than missing. */
function densify(daily: DailyCost[], days: number): DailyCost[] {
  const byDate = new Map(daily.map(d => [d.date, d]));
  const out: DailyCost[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const at = new Date(Date.now() - i * 86400_000);
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    out.push(byDate.get(date) || { date, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 });
  }
  return out;
}

export function DailyCostChart({ daily }: { daily: DailyCost[] }) {
  const [range, setRange] = useState(30);
  const [hover, setHover] = useState<DailyCost | null>(null);

  const series = useMemo(() => densify(daily, range), [daily, range]);
  const max = Math.max(...series.map(d => d.costUsd), 0.0001);
  const peak = series.reduce((best, d) => (d.costUsd > best.costUsd ? d : best), series[0]);
  const total = series.reduce((sum, d) => sum + d.costUsd, 0);

  // Thin bars once the range is long; a visible gap while it is short.
  const gapClass = range > 45 ? 'gap-px' : 'gap-0.5';

  return (
    <div>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
        <h3 className="font-medium text-gray-900">Daily cost</h3>
        <div className="flex gap-1">
          {[7, 30, 90].map(option => (
            <button
              key={option}
              onClick={() => setRange(option)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                range === option
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-600 hover:border-gray-500'
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {money(total)} over the last {range} days
      </p>

      <div className="relative">
        {/* Recessive reference lines, labelled in ink rather than the series colour */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
          {[1, 0.5, 0].map(fraction => (
            <div key={fraction} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 w-12 text-right shrink-0">
                {money(max * fraction)}
              </span>
              <span className="flex-1 border-t border-gray-100" />
            </div>
          ))}
        </div>

        <div className="pl-14">
          <div className={`flex items-end ${gapClass} h-40`}>
            {series.map(day => {
              const isHovered = hover?.date === day.date;
              const height = day.costUsd > 0 ? Math.max(2, (day.costUsd / max) * 100) : 1;
              return (
                <button
                  key={day.date}
                  onMouseEnter={() => setHover(day)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(day)}
                  onBlur={() => setHover(null)}
                  aria-label={`${labelFor(day.date)}: ${money(day.costUsd)} across ${day.calls} calls`}
                  className="flex-1 min-w-0 flex items-end h-full group"
                >
                  <span
                    className="w-full rounded-t transition-colors"
                    style={{
                      height: `${height}%`,
                      backgroundColor: day.costUsd > 0
                        ? (isHovered ? SERIES_HOVER : SERIES)
                        : '#e5e7eb',
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Selective direct label: the peak day only */}
        {peak && peak.costUsd > 0 && !hover && (
          <div className="pl-14 mt-1 text-[10px] text-gray-500">
            Peak {labelFor(peak.date)} · {money(peak.costUsd)}
          </div>
        )}

        {hover && (
          <div className="pl-14 mt-1 text-[10px] text-gray-700">
            <span className="font-medium">{labelFor(hover.date)}</span>
            {' · '}{money(hover.costUsd)}
            {' · '}{hover.calls} call{hover.calls === 1 ? '' : 's'}
            {hover.calls > 0 && ` · ${(hover.inputTokens / 1000).toFixed(1)}k in / ${(hover.outputTokens / 1000).toFixed(1)}k out`}
          </div>
        )}
      </div>

      <div className="pl-14 flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{labelFor(series[0].date)}</span>
        <span>{labelFor(series[series.length - 1].date)}</span>
      </div>
    </div>
  );
}
