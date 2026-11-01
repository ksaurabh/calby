import { useEffect, useState } from 'react';

export interface ProgressStep {
  message: string;
  offsetMs: number;
}

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

/**
 * What a slow request is doing, step by step: finished steps ticked with how
 * long they took, the current one with a live timer.
 */
export function ProgressSteps({ steps, startedAt, idleLabel }: {
  steps: ProgressStep[];
  startedAt: number;
  idleLabel: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now - startedAt;

  if (!steps.length) {
    return (
      <div className="flex items-center justify-center gap-3 text-gray-500">
        <span className="h-4 w-4 rounded-full border-2 border-blue-600 border-b-transparent animate-spin" />
        {idleLabel} · {seconds(elapsed)}
      </div>
    );
  }

  return (
    <ol className="space-y-2 text-sm text-left max-w-xl mx-auto">
      {steps.map((step, i) => {
        const current = i === steps.length - 1;
        const took = current ? elapsed - step.offsetMs : steps[i + 1].offsetMs - step.offsetMs;
        return (
          <li key={i} className="flex items-start gap-3">
            {current ? (
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-blue-600 border-b-transparent animate-spin" />
            ) : (
              <span className="mt-0.5 h-4 w-4 shrink-0 text-green-600 leading-4 text-center">✓</span>
            )}
            <span className={`flex-1 ${current ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>{step.message}</span>
            <span className="text-xs text-gray-400 tabular-nums">{seconds(took)}</span>
          </li>
        );
      })}
      <li className="pt-1 text-xs text-gray-400 text-right tabular-nums">{seconds(elapsed)} so far</li>
    </ol>
  );
}
