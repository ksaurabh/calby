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
 * expires two weeks after it's made. Each has a short description of who
 * it's for.
 */
export function OneOffLinks({ eventTypeId }: { eventTypeId: string }) {
  const [links, setLinks] = useState<OneOffLink[]>([]);
  const [asking, setAsking] = useState(false);
  const [description, setDescription] = useState('');
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

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { link } = await api.createOneOffLink(eventTypeId, description.trim());
      setLinks(list => [link, ...list]);
      setDescription('');
      setAsking(false);
      await copy(link);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (link: OneOffLink) => {
    const what = link.description ? `the one-off link for "${link.description}"` : 'this one-off link';
    const warning = link.state === 'open' ? ' Anyone you sent it to won’t be able to book with it.' : '';
    if (!window.confirm(`Delete ${what}?${warning}`)) return;
    setError(null);
    try {
      await api.deleteOneOffLink(eventTypeId, link.id);
      setLinks(list => list.filter(l => l.id !== link.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mt-3">
      {asking ? (
        <form onSubmit={generate} className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 min-w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="Short description, e.g. “Jane Doe at Acme — pricing follow-up”"
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={120}
            autoFocus
            required
          />
          <Button type="submit" className={smallButton} disabled={busy || !description.trim()}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={smallButton}
            onClick={() => { setAsking(false); setDescription(''); setError(null); }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="ghost" className={smallButton} onClick={() => setAsking(true)}>
            + Generate a one-off link
          </Button>
          <span className="text-xs text-gray-400">Works for one booking; expires after 2 weeks.</span>
        </div>
      )}
      {error && <div className="mt-2 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">{error}</div>}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map(link => (
            <li key={link.id} className={`flex items-center gap-2 text-xs ${link.state === 'open' ? '' : 'opacity-60'}`}>
              <span className="w-56 shrink-0 truncate text-gray-800 font-medium" title={link.description}>
                {link.description || <span className="text-gray-400 font-normal italic">no description</span>}
              </span>
              <code className={`flex-1 min-w-0 truncate bg-gray-50 rounded px-2 py-1 text-gray-700 ${link.state === 'open' ? '' : 'line-through'}`}>
                {linkUrl(link.slug)}
              </code>
              <span className="w-28 shrink-0 text-gray-500">
                {link.state === 'open' && `expires ${shortDate(link.expiresAt)}`}
                {link.state === 'used' && `used ${link.usedAt ? shortDate(link.usedAt) : ''}`}
                {link.state === 'expired' && `expired ${shortDate(link.expiresAt)}`}
              </span>
              {link.state === 'open' && (
                <Button variant="ghost" className={smallButton} onClick={() => copy(link)}>
                  {copied === link.id ? 'Copied' : 'Copy'}
                </Button>
              )}
              <Button variant="ghost" className={`${smallButton} text-red-600 hover:text-red-700`} onClick={() => remove(link)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
