import { useEffect, useState } from 'react';
import type { OneOffLink } from '../../types';
import { api } from '../../utils/api';
import { Button } from '../common';

const smallButton = '!px-2 !py-1 text-xs';
const linkUrl = (slug: string) => `${window.location.origin}/book/${slug}`;
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * One-off links for an event type: each works for a single booking and
 * expires two weeks after it's made.
 */
export function OneOffLinks({ eventTypeId }: { eventTypeId: string }) {
  const [links, setLinks] = useState<OneOffLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.oneOffLinks(eventTypeId).then(r => setLinks(r.links)).catch(() => {});
  }, [eventTypeId]);

  const copy = async (link: OneOffLink) => {
    try {
      await navigator.clipboard.writeText(linkUrl(link.slug));
      setCopied(link.id);
      window.setTimeout(() => setCopied(c => (c === link.id ? null : c)), 2000);
    } catch {
      setError('Your browser blocked copying to the clipboard.');
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { link } = await api.createOneOffLink(eventTypeId);
      setLinks(list => [link, ...list]);
      await copy(link);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link: OneOffLink) => {
    if (link.state === 'open' && !window.confirm('Turn this one-off link off? Anyone you sent it to won’t be able to book with it.')) return;
    setError(null);
    try {
      await api.deleteOneOffLink(eventTypeId, link.id);
      setLinks(list => list.filter(l => l.id !== link.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" className={smallButton} onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : '+ Generate a one-off link'}
        </Button>
        <span className="text-xs text-gray-400">Works for one booking; expires after 2 weeks.</span>
      </div>
      {error && <div className="mt-2 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">{error}</div>}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map(link => (
            <li key={link.id} className={`flex items-center gap-2 text-xs ${link.state === 'open' ? '' : 'opacity-60'}`}>
              <code className={`flex-1 truncate bg-gray-50 rounded px-2 py-1 text-gray-700 ${link.state === 'open' ? '' : 'line-through'}`}>
                {linkUrl(link.slug)}
              </code>
              <span className="w-36 shrink-0 text-gray-500">
                {link.state === 'open' && `expires ${shortDate(link.expiresAt)}`}
                {link.state === 'used' && `used ${link.usedAt ? shortDate(link.usedAt) : ''}`}
                {link.state === 'expired' && `expired ${shortDate(link.expiresAt)}`}
              </span>
              {link.state === 'open' && (
                <Button variant="ghost" className={smallButton} onClick={() => copy(link)}>
                  {copied === link.id ? 'Copied' : 'Copy'}
                </Button>
              )}
              <Button variant="ghost" className={smallButton} onClick={() => revoke(link)}>
                {link.state === 'open' ? 'Turn off' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
