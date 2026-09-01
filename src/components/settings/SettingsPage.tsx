import { useCallback, useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common';
import { DailyCostChart } from './DailyCostChart';
import type { DailyCost } from './DailyCostChart';

interface Usage {
  scope: 'me' | 'org';
  canSeeOrg: boolean;
  timezone: string;
  days: number;
  last24h: { costUsd: number; calls: number };
  total: { costUsd: number; calls: number };
  daily: DailyCost[];
  byFeature: { feature: string; costUsd: number; calls: number }[];
}

const FEATURE_LABELS: Record<string, string> = {
  guidance: 'Reading event-type guidance',
  classification: 'Commitment classification',
  'commitment-report': 'Per-event commitment reports',
  'slot-review': 'Commitment-aware slot review',
  assistant: 'Calendar assistant',
};

const money = (usd: number) =>
  usd >= 1 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : '$0.00';

export function SettingsPage() {
  const { aiKeySource } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scope, setScope] = useState<'me' | 'org'>('me');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await api.usage(scope));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          What the AI features have cost, and on whose key they are running.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-900">LLM cost</h2>
            <p className="text-sm text-gray-500 mt-1">
              Charged to{' '}
              {aiKeySource === 'org'
                ? "your organization's Anthropic key"
                : aiKeySource === 'server'
                  ? "the server's Anthropic key"
                  : 'nothing — no key is configured'}
              . Costs are computed from the tokens each call reported, at Anthropic's
              published rates.
            </p>
          </div>
          <div className="flex gap-2">
            {usage?.canSeeOrg && (
              <div className="flex gap-1">
                {(['me', 'org'] as const).map(option => (
                  <button
                    key={option}
                    onClick={() => setScope(option)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      scope === option
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-600 hover:border-gray-500'
                    }`}
                  >
                    {option === 'me' ? 'Just me' : 'Whole organization'}
                  </button>
                ))}
              </div>
            )}
            <Button variant="secondary" onClick={load}>Refresh</Button>
          </div>
        </div>

        {loading || !usage ? (
          <div className="py-12 text-center text-gray-500">Loading…</div>
        ) : (
          <>
            {/* The headline the question asks for: the last 24 hours. */}
            <div className="grid gap-4 sm:grid-cols-3 mt-6">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Last 24 hours</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">
                  {money(usage.last24h.costUsd)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {usage.last24h.calls} model call{usage.last24h.calls === 1 ? '' : 's'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Last {usage.days} days</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">
                  {money(usage.total.costUsd)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {usage.total.calls} model call{usage.total.calls === 1 ? '' : 's'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Average per day</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">
                  {money(usage.total.costUsd / usage.days)}
                </div>
                <div className="text-xs text-gray-500 mt-1">across {usage.days} days</div>
              </div>
            </div>

            <div className="mt-8">
              <DailyCostChart daily={usage.daily} />
            </div>

            {usage.byFeature.length > 0 && (
              <div className="mt-8">
                <h3 className="font-medium text-gray-900 mb-3">Where it went</h3>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 font-medium">Feature</th>
                      <th className="py-2 font-medium text-right">Calls</th>
                      <th className="py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {usage.byFeature.map(row => (
                      <tr key={row.feature}>
                        <td className="py-2 text-gray-900">
                          {FEATURE_LABELS[row.feature] || row.feature}
                        </td>
                        <td className="py-2 text-gray-600 text-right">{row.calls}</td>
                        <td className="py-2 text-gray-900 text-right">{money(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* The same data as the chart, readable without colour. */}
            <details className="mt-8">
              <summary className="text-sm text-gray-600 cursor-pointer">
                Daily history ({usage.daily.length} day{usage.daily.length === 1 ? '' : 's'} with activity)
              </summary>
              <table className="w-full text-sm mt-3">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium text-right">Calls</th>
                    <th className="py-2 font-medium text-right">Tokens in</th>
                    <th className="py-2 font-medium text-right">Tokens out</th>
                    <th className="py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...usage.daily].reverse().map(day => (
                    <tr key={day.date}>
                      <td className="py-2 text-gray-900">{day.date}</td>
                      <td className="py-2 text-gray-600 text-right">{day.calls}</td>
                      <td className="py-2 text-gray-600 text-right">{day.inputTokens.toLocaleString()}</td>
                      <td className="py-2 text-gray-600 text-right">{day.outputTokens.toLocaleString()}</td>
                      <td className="py-2 text-gray-900 text-right">{money(day.costUsd)}</td>
                    </tr>
                  ))}
                  {usage.daily.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-500">
                        No model calls yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
