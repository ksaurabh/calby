import { useState } from 'react';
import type { Org } from '../../types';
import { formatDate } from '../../utils/format';
import { Button } from '../common';

interface OrgApiKeyProps {
  org: Org;
  onSave: (apiKey: string) => Promise<void>;
  onRemove: () => Promise<void>;
}

/**
 * One Anthropic key per organization, set by its admin and used by everyone on
 * the org's email domain. The key is verified with Anthropic before it is
 * stored, sealed on disk, and never sent back to the browser — only a masked
 * hint of it.
 */
export function OrgApiKey({ org, onSave, onRemove }: OrgApiKeyProps) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(apiKey.trim());
      setApiKey('');
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the Anthropic key for ${org.name}? Its members fall back to the server key, if there is one.`)) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{error}</div>}

      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Anthropic API key for everyone at {org.domain || 'this organization'}
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              required
              autoFocus
            />
            <Button type="submit" disabled={busy || !apiKey.trim()}>
              {busy ? 'Verifying…' : 'Save key'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setEditing(false); setApiKey(''); setError(null); }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            From console.anthropic.com. It is checked against Anthropic before saving,
            stored encrypted, and never shown again.
          </p>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            {org.hasAnthropicKey ? (
              <>
                <span className="text-gray-700 font-medium">Anthropic key set</span>
                <span className="text-gray-500">
                  {' '}· <code className="font-mono">{org.anthropicKeyHint}</code>
                  {org.anthropicKeySetBy && ` · added by ${org.anthropicKeySetBy}`}
                  {org.anthropicKeySetAt && ` on ${formatDate(org.anthropicKeySetAt)}`}
                </span>
                <div className="text-gray-500 mt-0.5">
                  Used by everyone with an @{org.domain} address.
                </div>
              </>
            ) : (
              <span className="text-gray-500">
                No Anthropic key. Members use the server key, if one is configured.
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {org.hasAnthropicKey ? 'Replace key' : 'Add key'}
            </Button>
            {org.hasAnthropicKey && (
              <Button variant="ghost" onClick={remove} disabled={busy}>Remove</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
