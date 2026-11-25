import { createHash } from 'crypto';

/**
 * Learning Loop T02: deterministic company-level variant assignment.
 *
 * Variant pick = sha256(experiment_id + ':' + company_key) -> first 8 bytes ->
 * uniform [0, 1) -> cumulative allocation over variants with status 'active'
 * (50/50 in V1, ordered by created_at).
 */

export interface AssignableVariant {
  id: string;
  label: string;
  subject: string;
  status: string; // 'active' | 'paused' | 'draft'
  is_control?: boolean;
  created_at?: Date | string;
}

const TWO_POW_64 = 18446744073709551616; // 2^64

export function assignmentHash(
  experimentId: string,
  companyKey: string,
): { hex: string; uniform: number } {
  const buf = createHash('sha256')
    .update(`${experimentId}:${companyKey}`)
    .digest();
  const hi = buf.readBigUInt64BE(0);
  // Number conversion of 64-bit int / 2^64 yields a float in [0, 1].
  // Clamp to < 1 for the degenerate all-1s case.
  const raw = Number(hi) / TWO_POW_64;
  const uniform = raw >= 1 ? 1 - Number.EPSILON : raw;
  return { hex: buf.subarray(0, 8).toString('hex'), uniform };
}

export function pickExperimentVariant<T extends AssignableVariant>(
  experimentId: string,
  companyKey: string,
  variants: T[],
  weights?: number[],
): { variant: T; variantIndex: number; hash: string; uniform: number } {
  // Keep original indices so variant_index on sent_emails matches the
  // variant's position in the experiment's ordered variant list.
  const active = variants
    .map((variant, variantIndex) => ({ variant, variantIndex }))
    .filter((v) => v.variant.status === 'active');

  if (active.length === 0) {
    throw new Error('Experiment has no active variants to assign');
  }

  const { hex, uniform } = assignmentHash(experimentId, companyKey);
  if (active.length === 1) {
    return {
      variant: active[0].variant,
      variantIndex: active[0].variantIndex,
      hash: hex,
      uniform,
    };
  }

  // Build normalized weights over active variants (default: equal 1/N each).
  const rawWeights = active.map((_, i) => {
    const w = weights?.[i];
    return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1;
  });
  const totalWeight = rawWeights.reduce((a, b) => a + b, 0);

  let cumulative = 0;
  for (let i = 0; i < active.length; i++) {
    cumulative += rawWeights[i] / totalWeight;
    if (uniform < cumulative || i === active.length - 1) {
      return {
        variant: active[i].variant,
        variantIndex: active[i].variantIndex,
        hash: hex,
        uniform,
      };
    }
  }

  const last = active[active.length - 1];
  return {
    variant: last.variant,
    variantIndex: last.variantIndex,
    hash: hex,
    uniform,
  };
}
