import { Pool } from 'pg';
import { withOrgContext } from '../db/tenant-context';
import type { KeywordCandidate, LoadCandidates } from './playbook-retriever';

/**
 * The playbooks the keyword search looks through (Learning Loop T14): the
 * ACTIVE, UNEXPIRED ones of one offer in one workspace (row-level security
 * applies). `onlyUnindexed` narrows it to playbooks that have no vector yet.
 */
export function candidateLoader(pool: Pool): LoadCandidates {
  return (orgId, offerId, opts) =>
    withOrgContext(pool, orgId, async (c) => {
      const r = await c.query<KeywordCandidate>(
        `SELECT id, title, body FROM playbooks
          WHERE offer_id = $1 AND status = 'active' AND valid_to > now()
            AND ($2::boolean = false OR vector_status <> 'indexed')
          ORDER BY created_at DESC LIMIT 200`,
        [offerId, opts.onlyUnindexed],
      );
      return r.rows;
    });
}
