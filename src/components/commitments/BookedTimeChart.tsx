import { Fragment, useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentType } from '../../types';

// Time on the calendar per day, stacked by commitment type: the last 7 days
// and the next 7 (today included). Only time that actually blocks the
// calendar counts — timed entries shown as busy that you haven't declined.

const NO_TYPE = { id: '__none', name: 'No type', color: '#9ca3af' };
const DAY = 86400_000;

interface Series {
  id: string;
  name: string;
  color: string;
}

const dayKey = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

const blocksTime = (e: CalendarEvent) =>
  !e.allDay && e.showAs !== 'free' && e.myResponse !== 'declined';

const hours = (minutes: number) => {
  const h = minutes / 60;
  return h === 0 ? '0h' : h < 10 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h)}h`;
};

export function BookedTimeChart({
  events,
  commitmentTypes,
  timezone,
  now,
}: {
  events: CalendarEvent[];
  commitmentTypes: CommitmentType[];
  timezone: string;
  now: number;
}) {
  const [hover, setHover] = useState<{ day: number; series: string } | null>(null);

  const { days, series, maxMinutes, totals } = useMemo(() => {
    // 14 local days: 7 before today, then today and the 6 after.
    const days = Array.from({ length: 14 }, (_, i) => {
      const ms = now + (i - 7) * DAY;
      return {
        key: dayKey(ms, timezone),
        label: new Date(ms).toLocaleDateString(undefined, { weekday: 'short', timeZone: timezone }),
        date: new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: timezone }),
        future: i >= 7,
        minutes: new Map<string, number>(),
      };
    });
    const byKey = new Map(days.map(d => [d.key, d]));

    for (const e of events) {
      if (!blocksTime(e)) continue;
      const start = Date.parse(e.start);
      const end = Date.parse(e.end);
      if (!(end > start)) continue;
      const day = byKey.get(dayKey(start, timezone));
      if (!day) continue;
      const id = e.commitmentTypeId || NO_TYPE.id;
      day.minutes.set(id, (day.minutes.get(id) || 0) + Math.min(end - start, DAY) / 60000);
    }

    // Types in their priority order, then "No type" — only those with time.
    const all: Series[] = [...commitmentTypes, NO_TYPE];
    const used = all.filter(s => days.some(d => d.minutes.get(s.id)));
    const totals = new Map(used.map(s => [s.id, { past: 0, next: 0 }]));
    for (const d of days) {
      for (const [id, m] of d.minutes) {
        const t = totals.get(id);
        if (t) t[d.future ? 'next' : 'past'] += m;
      }
    }
    const maxMinutes = Math.max(60, ...days.map(d => [...d.minutes.values()].reduce((a, b) => a + b, 0)));
    return { days, series: used, maxMinutes, totals };
  }, [events, commitmentTypes, timezone, now]);

  // Geometry
  const W = 720;
  const H = 220;
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / days.length;
  const barW = Math.min(30, slot * 0.6);
  const stepH = maxMinutes <= 4 * 60 ? 60 : maxMinutes <= 8 * 60 ? 120 : 240;
  const top = Math.ceil(maxMinutes / stepH) * stepH;
  const y = (m: number) => padT + plotH - (m / top) * plotH;
  const ticks = Array.from({ length: top / stepH + 1 }, (_, i) => i * stepH);
  const GAP = 2;

  const sum = (which: 'past' | 'next') => [...totals.values()].reduce((a, t) => a + t[which], 0);
  const hovered = hover && days[hover.day];
  const hoveredSeries = hover && series.find(s => s.id === hover.series);

  return (
    <div>
      {series.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">Nothing booked in these two weeks.</div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Hours booked per day by commitment type">
            {/* Recessive grid */}
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{t / 60}h</text>
              </g>
            ))}

            {/* Today divider */}
            <line
              x1={padL + slot * 7} x2={padL + slot * 7}
              y1={padT - 4} y2={padT + plotH}
              stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={1}
            />
            <text x={padL + slot * 7 - 4} y={padT + 2} textAnchor="end" fontSize={10} fill="#6b7280">Last 7 days</text>
            <text x={padL + slot * 7 + 4} y={padT + 2} fontSize={10} fill="#6b7280">Next 7 days</text>

            {days.map((d, i) => {
              const x = padL + slot * i + (slot - barW) / 2;
              let acc = 0;
              const segments = series
                .map(s => ({ s, m: d.minutes.get(s.id) || 0 }))
                .filter(seg => seg.m > 0);
              return (
                <g key={d.key}>
                  {segments.map((seg, j) => {
                    const y0 = y(acc);
                    acc += seg.m;
                    const y1 = y(acc);
                    const isTop = j === segments.length - 1;
                    // A 2px surface gap between stacked segments.
                    const h = Math.max(1, y0 - y1 - (j > 0 ? GAP : 0));
                    const yTop = y1;
                    const r = isTop ? Math.min(4, h) : 0;
                    const dim = hover && hover.series !== seg.s.id;
                    return (
                      <path
                        key={seg.s.id}
                        d={roundedTop(x, yTop, barW, h, r)}
                        fill={seg.s.color}
                        opacity={dim ? 0.35 : 1}
                        onMouseEnter={() => setHover({ day: i, series: seg.s.id })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                  <text x={padL + slot * i + slot / 2} y={H - padB + 14} textAnchor="middle" fontSize={10}
                    fill={i === 7 ? '#111827' : '#6b7280'} fontWeight={i === 7 ? 600 : 400}>
                    {i === 7 ? 'Today' : d.label}
                  </text>
                  <text x={padL + slot * i + slot / 2} y={H - padB + 27} textAnchor="middle" fontSize={9} fill="#9ca3af">
                    {d.date}
                  </text>
                  {/* Hit target: the whole column, for the day's tooltip */}
                  <rect
                    x={padL + slot * i} y={padT} width={slot} height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(h => (h && h.day === i ? h : { day: i, series: '' }))}
                    onMouseLeave={() => setHover(null)}
                    style={{ pointerEvents: segments.length ? 'none' : 'auto' }}
                  />
                </g>
              );
            })}
          </svg>

          {hovered && (
            <div
              className="absolute pointer-events-none bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs"
              style={{
                left: `${((padL + slot * hover!.day + slot / 2) / W) * 100}%`,
                top: 0,
                transform: `translateX(${hover!.day >= 10 ? '-100%' : hover!.day <= 3 ? '0' : '-50%'})`,
              }}
            >
              <div className="font-medium text-gray-900 mb-1">{hovered.label}, {hovered.date}</div>
              {series.filter(s => hovered.minutes.get(s.id)).map(s => (
                <div key={s.id} className={`flex items-center gap-2 ${hoveredSeries && hoveredSeries.id !== s.id ? 'text-gray-400' : 'text-gray-700'}`}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="tabular-nums">{hours(hovered.minutes.get(s.id) || 0)}</span>
                </div>
              ))}
              {![...hovered.minutes.values()].some(Boolean) && <div className="text-gray-500">Nothing booked</div>}
            </div>
          )}
        </div>
      )}

      {/* Legend and table view in one: hours per type, day by day, with week subtotals */}
      {series.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="text-left font-medium py-1.5 pr-3">Day</th>
                {series.map(s => (
                  <th
                    key={s.id}
                    className="text-right font-medium py-1.5 px-2 whitespace-nowrap"
                    onMouseEnter={() => setHover({ day: -1, series: s.id })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                  </th>
                ))}
                <th className="text-right font-medium py-1.5 pl-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => {
                const dayTotal = [...d.minutes.values()].reduce((a, b) => a + b, 0);
                return (
                  <Fragment key={d.key}>
                    <tr
                      className={`border-b border-gray-100 ${hover?.day === i ? 'bg-gray-50' : ''}`}
                      onMouseEnter={() => setHover({ day: i, series: '' })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <td className={`py-1 pr-3 whitespace-nowrap ${i === 7 ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                        {i === 7 ? 'Today' : d.label}, {d.date}
                      </td>
                      {series.map(s => (
                        <td key={s.id} className="py-1 px-2 text-right tabular-nums text-gray-700">
                          {d.minutes.get(s.id) ? hours(d.minutes.get(s.id)!) : <span className="text-gray-300">–</span>}
                        </td>
                      ))}
                      <td className="py-1 pl-2 text-right tabular-nums text-gray-900">{hours(dayTotal)}</td>
                    </tr>
                    {(i === 6 || i === 13) && (
                      <tr className="border-b-2 border-gray-200 bg-gray-50 font-medium">
                        <td className="py-1.5 pr-3 text-gray-900">{i === 6 ? 'Last 7 days' : 'Next 7 days'}</td>
                        {series.map(s => (
                          <td key={s.id} className="py-1.5 px-2 text-right tabular-nums text-gray-900">
                            {hours(totals.get(s.id)![i === 6 ? 'past' : 'next'])}
                          </td>
                        ))}
                        <td className="py-1.5 pl-2 text-right tabular-nums text-gray-900">{hours(sum(i === 6 ? 'past' : 'next'))}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A bar segment with only its top corners rounded (data end), anchored to the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
