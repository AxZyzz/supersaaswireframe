'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, History, Pencil } from 'lucide-react';
import { ReviewNav } from '@/components/review-nav';
import { EditPlaybookDialog } from '@/components/playbook-dialogs';
import { LoadError, loadErrorText, toast } from '@/components/feedback';
import { errorMessage } from '@/lib/api';
import { canManage, useRole } from '@/lib/me';
import { listOffers, Offer } from '@/lib/offers';
import {
  KIND_LABEL,
  listPlaybooks,
  Playbook,
  playbookVersions,
  reindexPlaybooks,
  retirePlaybook,
  validityText,
} from '@/lib/playbooks';

const card = 'rounded-lg border border-line bg-surface p-4';
const field =
  'rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent';
const btn =
  'rounded border border-line-mid px-2.5 py-1 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50';

const pill = (tone: 'ok' | 'muted' | 'warn') =>
  `rounded-full px-2 py-0.5 text-tiny font-medium ${
    tone === 'ok'
      ? 'bg-success-bg text-success-text'
      : tone === 'warn'
        ? 'bg-warning-bg text-warning-text'
        : 'bg-neut-bg text-muted'
  }`;

const FACTOR_LABEL: Record<string, string> = {
  city: 'City',
  region: 'State / region',
  country: 'Country',
  industry: 'Industry',
  size_band: 'Company size',
  trigger: 'Buying trigger',
};

function statusPill(p: Playbook) {
  if (p.status === 'retired')
    return <span className={pill('muted')}>Retired</span>;
  if (p.status === 'superseded')
    return <span className={pill('muted')}>Replaced</span>;
  if (p.expired) return <span className={pill('warn')}>Expired</span>;
  return <span className={pill('ok')}>Active</span>;
}

function EvidenceLink({ p }: { p: Playbook }) {
  const e = p.evidence;
  if (e.source === 'review') {
    return (
      <span>
        Evidence: review revision {e.revision}
        {e.campaignId && (
          <>
            {' '}
            ·{' '}
            <Link
              href={`/campaigns?open=${e.campaignId}&tab=review`}
              className="text-accent hover:underline"
              data-testid="playbook-evidence-link"
            >
              open the test&apos;s Review
            </Link>
          </>
        )}
      </span>
    );
  }
  return (
    <span>
      Evidence: a search-preference result ·{' '}
      <Link
        href="/discover"
        className="text-accent hover:underline"
        data-testid="playbook-evidence-link"
      >
        open Discover
      </Link>
    </span>
  );
}

export default function PlaybooksPage() {
  const role = useRole();
  const manage = canManage(role);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerId, setOfferId] = useState('');
  const [items, setItems] = useState<Playbook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, Playbook[]>>({});
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listPlaybooks(offerId || undefined));
    } catch (e) {
      setItems(null);
      setError(loadErrorText(e));
    }
  }, [offerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void listOffers()
      .then(setOffers)
      .catch(() => undefined);
  }, []);

  async function toggleHistory(p: Playbook) {
    if (history[p.id]) {
      setHistory(({ [p.id]: _gone, ...rest }) => rest);
      return;
    }
    try {
      setHistory((h) => ({ ...h, [p.id]: [] }));
      const v = await playbookVersions(p.id);
      setHistory((h) => ({ ...h, [p.id]: v }));
    } catch (e) {
      setHistory(({ [p.id]: _gone, ...rest }) => rest);
      toast(errorMessage(e, "Couldn't load the history."), 'error');
    }
  }

  async function retire(p: Playbook) {
    setBusy(true);
    try {
      await retirePlaybook(p.id);
      toast('Retired. It will no longer be used as a hint.', 'success');
      setRetiring(null);
      setHistory({});
      await load();
    } catch (e) {
      toast(errorMessage(e, "Couldn't retire it."), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setBusy(true);
    try {
      const r = await reindexPlaybooks();
      toast(
        r.skipped
          ? 'Search is on keywords right now, so there is no vector index to rebuild.'
          : `Search index rebuilt: ${r.indexed} indexed, ${r.failed} failed.`,
        r.failed ? 'error' : 'success',
      );
      await load();
    } catch (e) {
      toast(errorMessage(e, "Couldn't rebuild the index."), 'error');
    } finally {
      setBusy(false);
    }
  }

  const needsIndex = (items ?? []).some(
    (p) => p.status === 'active' && p.vectorStatus !== 'indexed',
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink2">Review</h1>
        <p className="mt-1 text-sm text-muted">
          What the team learned and approved. The next searches and subject
          drafts get the closest few as hints (never as facts), and a hint
          expires after its validity.
        </p>
      </header>
      <ReviewNav />

      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1 text-tiny text-faint">
          Offer
          <select
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            className={field}
            data-testid="playbook-offer-filter"
          >
            <option value="">All offers</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {role === 'admin' && needsIndex && (
          <button
            onClick={() => void rebuild()}
            disabled={busy}
            className={`${btn} ml-auto`}
          >
            Rebuild search index
          </button>
        )}
      </div>

      {error && <LoadError message={error} onRetry={() => void load()} />}
      {!error && items === null && (
        <p className="text-sm text-muted">Loading…</p>
      )}
      {items && items.length === 0 && (
        <div className={`${card} text-center text-sm text-muted`}>
          <BookOpen size={20} className="mx-auto mb-2 text-faint" />
          <p className="font-medium text-ink">No playbooks yet.</p>
          <p className="mx-auto mt-1 max-w-md">
            When you approve a winning subject (Review → pause the losing
            version) or a search preference, choose{' '}
            <strong>Save as playbook</strong> to keep what you learned.
          </p>
        </div>
      )}

      <ul className="space-y-3" aria-label="Playbooks">
        {(items ?? []).map((p) => (
          <li
            key={p.id}
            id={`pb-${p.id}`}
            className={card}
            data-testid="playbook-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink2">{p.title}</h2>
              {statusPill(p)}
              <span className={pill('muted')}>{KIND_LABEL[p.kind]}</span>
              <span className="text-tiny text-muted">Version {p.version}</span>
            </div>
            <p className="mt-0.5 text-tiny text-faint">
              {p.offerName ?? 'Offer'}
              {p.segment &&
                ` · ${FACTOR_LABEL[p.segment.factor] ?? p.segment.factor}: ${p.segment.value.replace(/_/g, ' ')}`}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
              {p.body}
            </p>
            <p className="mt-2 text-tiny text-muted">
              {validityText(p)} · saved by {p.createdBy?.name ?? 'someone'} on{' '}
              {new Date(p.createdAt).toLocaleDateString()}
            </p>
            <p className="mt-0.5 text-tiny text-muted">
              <EvidenceLink p={p} />
            </p>
            {role === 'admin' &&
              p.status === 'active' &&
              p.vectorStatus !== 'indexed' && (
                <p className="mt-0.5 text-tiny text-warning-text">
                  Search index:{' '}
                  {p.vectorStatus === 'failed'
                    ? 'failed (keyword search still finds it)'
                    : 'not built yet'}
                </p>
              )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {manage && p.status === 'active' && (
                <button onClick={() => setEditing(p)} className={btn}>
                  <Pencil size={12} className="mr-1 inline" /> Edit
                </button>
              )}
              {manage && p.status === 'active' && retiring !== p.id && (
                <button onClick={() => setRetiring(p.id)} className={btn}>
                  Retire
                </button>
              )}
              {p.version > 1 || p.supersedesId ? (
                <button
                  onClick={() => void toggleHistory(p)}
                  className={btn}
                  aria-expanded={!!history[p.id]}
                >
                  <History size={12} className="mr-1 inline" /> History
                </button>
              ) : null}
            </div>

            {retiring === p.id && (
              <div className="mt-3 rounded border border-line bg-panel p-3 text-sm">
                <p className="text-ink">
                  Retire <strong>{p.title}</strong>? It will no longer be used
                  as a hint. It stays here as history.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void retire(p)}
                    disabled={busy}
                    className={btn}
                    data-testid="playbook-retire-confirm"
                  >
                    {busy ? 'Retiring…' : 'Retire'}
                  </button>
                  <button
                    onClick={() => setRetiring(null)}
                    disabled={busy}
                    className={btn}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {history[p.id] && (
              <ol
                className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm"
                aria-label="Version history"
              >
                {history[p.id].length === 0 && (
                  <li className="text-muted">Loading…</li>
                )}
                {history[p.id].map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span className="font-medium text-ink">
                      Version {v.version}
                    </span>
                    <span className="text-tiny text-muted">
                      {new Date(v.createdAt).toLocaleDateString()} ·{' '}
                      {v.createdBy?.name ?? 'someone'} · {validityText(v)}
                    </span>
                    <span className="w-full text-ink">{v.title}</span>
                    <span className="w-full text-muted">{v.body}</span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <EditPlaybookDialog
          playbook={editing}
          onClose={() => setEditing(null)}
          onSaved={async (np) => {
            setEditing(null);
            setHistory({});
            toast(`Saved as version ${np.version}.`, 'success');
            await load();
          }}
        />
      )}
    </div>
  );
}
