// Tests for the slot generator and the no-API-key guidance fallback.
//   node scripts/test-scheduling.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const { rulesFromText, normalizeRules, generateSlots, zonedTimeToUtc, zonedParts } =
  await import(join(here, '..', 'server', 'scheduling.js'));

let pass = 0, fail = 0;
const check = (label, cond, extra='') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + extra}`); };

// --- text fallback parsing ---
let r = rulesFromText('30 minute intro calls, weekdays 9am-5pm, next 2 weeks');
check('duration 30', r.durationMinutes === 30, r.durationMinutes);
check('9am start', r.startMinute === 540, r.startMinute);
check('5pm end', r.endMinute === 1020, r.endMinute);
check('2 weeks', r.horizonWeeks === 2, r.horizonWeeks);

r = rulesFromText('60 min deep dives, afternoons only, no fridays, 24 hours notice, 15 min gap between');
check('60 min', r.durationMinutes === 60, r.durationMinutes);
check('afternoon 12-5', r.startMinute === 720 && r.endMinute === 1020, `${r.startMinute}-${r.endMinute}`);
check('no fridays', JSON.stringify(r.weekdays) === '[1,2,3,4]', r.weekdays);
check('24h notice', r.minNoticeHours === 24, r.minNoticeHours);
check('15 min buffer', r.bufferMinutes === 15, r.bufferMinutes);

// --- normalization guards ---
const bad = normalizeRules({ durationMinutes: -5, startMinute: 1200, endMinute: 600, timezone: 'Not/AZone', weekdays: [9, 'x', 3], horizonWeeks: 99 });
check('duration floored', bad.durationMinutes >= 5, bad.durationMinutes);
check('end after start', bad.endMinute > bad.startMinute, `${bad.startMinute}-${bad.endMinute}`);
check('bad tz replaced', bad.timezone === 'America/Los_Angeles', bad.timezone);
check('weekdays filtered', JSON.stringify(bad.weekdays) === '[3]', bad.weekdays);
check('horizon capped', bad.horizonWeeks === 12, bad.horizonWeeks);

// --- timezone correctness ---
const ny = zonedTimeToUtc(2026, 1, 15, 9 * 60, 'America/New_York');   // winter, EST = UTC-5
check('EST 9am = 14:00Z', ny.toISOString() === '2026-01-15T14:00:00.000Z', ny.toISOString());
const nyDst = zonedTimeToUtc(2026, 7, 15, 9 * 60, 'America/New_York'); // summer, EDT = UTC-4
check('EDT 9am = 13:00Z', nyDst.toISOString() === '2026-07-15T13:00:00.000Z', nyDst.toISOString());
const ist = zonedTimeToUtc(2026, 7, 15, 9 * 60 + 30, 'Asia/Kolkata'); // UTC+5:30
check('IST 9:30am = 04:00Z', ist.toISOString() === '2026-07-15T04:00:00.000Z', ist.toISOString());
check('weekday of 2026-07-15 is Wed', zonedParts(new Date('2026-07-15T12:00:00Z'), 'UTC').weekday === 3);

// --- slot generation ---
const rules = normalizeRules({ durationMinutes: 30, horizonWeeks: 1, timezone: 'America/New_York',
  weekdays: [1,2,3,4,5], startMinute: 540, endMinute: 660, slotIntervalMinutes: 30, bufferMinutes: 0, minNoticeHours: 0, maxPerDay: 0 });
const now = new Date('2026-01-12T05:00:00Z'); // Monday 00:00 ET
let days = generateSlots({ rules, busy: [], now });
check('weekdays only (5 days in a week horizon)', days.length === 5, days.length);
check('4 slots/day for 9-11 at 30 min', days[0].slots.length === 4, days[0].slots.length);
check('first slot is 14:00Z (9am EST)', days[0].slots[0].start === '2026-01-12T14:00:00.000Z', days[0].slots[0].start);

// busy blocks one slot
days = generateSlots({ rules, busy: [{ start: new Date('2026-01-12T14:00:00Z'), end: new Date('2026-01-12T14:30:00Z') }], now });
check('busy removes exactly one slot', days[0].slots.length === 3, days[0].slots.length);
check('9:30 survives', days[0].slots[0].start === '2026-01-12T14:30:00.000Z', days[0].slots[0].start);

// buffer extends the block
const buffered = { ...rules, bufferMinutes: 30 };
days = generateSlots({ rules: buffered, busy: [{ start: new Date('2026-01-12T14:00:00Z'), end: new Date('2026-01-12T14:30:00Z') }], now });
check('30 min buffer removes two more', days[0].slots.length === 2, days[0].slots.length);

// min notice
days = generateSlots({ rules: { ...rules, minNoticeHours: 24 }, busy: [], now });
check('24h notice drops the first day', days[0].date !== '2026-01-12', days[0].date);

// already-booked slot
days = generateSlots({ rules, busy: [], now, takenStarts: ['2026-01-12T14:00:00.000Z'] });
check('taken slot excluded', days[0].slots[0].start === '2026-01-12T14:30:00.000Z', days[0].slots[0].start);

// maxPerDay
days = generateSlots({ rules: { ...rules, maxPerDay: 2 }, busy: [], now });
check('maxPerDay caps slots', days[0].slots.length === 2, days[0].slots.length);

// DST spring-forward day: America/New_York, 2026-03-08
const dstRules = normalizeRules({ ...rules, timezone: 'America/New_York', startMinute: 540, endMinute: 660, weekdays: [0,1,2,3,4,5,6] });
days = generateSlots({ rules: dstRules, busy: [], now: new Date('2026-03-08T05:00:00Z') });
const dstDay = days.find(d => d.date === '2026-03-08');
check('DST day 9am ET = 13:00Z (EDT)', dstDay?.slots[0].start === '2026-03-08T13:00:00.000Z', dstDay?.slots[0].start);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
