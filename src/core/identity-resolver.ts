import type { MatchEvidence } from "./types.js";

export interface IdentityCandidate {
  confidence: number;
  evidence: readonly MatchEvidence[];
  identity: string;
}

export interface IdentityResolution<T extends IdentityCandidate> {
  winner: T;
  ranked: Array<{ candidate: T; score: number }>;
  ambiguous: boolean;
  competing: T[];
}

/**
 * Ranks possible ayah identities using both textual confidence and
 * independent evidence. Close scores for different identities remain
 * ambiguous; this function never silently breaks a near tie.
 */
export function resolveAyahIdentity<T extends IdentityCandidate>(
  candidates: readonly T[],
  ambiguityMargin = 0.065
): IdentityResolution<T> | undefined {
  if (candidates.length === 0) return undefined;

  const ranked = candidates
    .map(candidate => ({ candidate, score: scoreIdentityCandidate(candidate) }))
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0]!.candidate;
  const winnerScore = ranked[0]!.score;
  const competing = ranked
    .filter(item =>
      item.candidate.identity !== winner.identity &&
      winnerScore - item.score <= ambiguityMargin
    )
    .map(item => item.candidate);

  return {
    winner,
    ranked,
    ambiguous: competing.length > 0,
    competing
  };
}

/** Transparent weighted score; evidence types are independent signals. */
export function scoreIdentityCandidate(candidate: IdentityCandidate): number {
  const types = new Set(candidate.evidence.map(item => item.type));
  let score = clamp(candidate.confidence, 0, 1);

  if (types.has("exact-text")) score += 0.035;
  if (types.has("normalized-text")) score += 0.015;
  if (types.has("verse-brackets")) score += 0.025;
  if (types.has("explicit-reference")) score += 0.075;
  if (types.has("fuzzy-alignment")) score -= 0.025;

  // A textual reference and a bracket marker together are stronger than
  // either signal alone, but cannot override a weak text alignment.
  if (types.has("explicit-reference") && types.has("verse-brackets")) score += 0.015;
  return clamp(score, 0, 0.999);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
