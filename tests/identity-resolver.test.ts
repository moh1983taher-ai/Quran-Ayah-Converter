import { describe, expect, it } from "vitest";
import { resolveAyahIdentity, scoreIdentityCandidate } from "../src/core/identity-resolver.js";
import type { MatchEvidence } from "../src/core/types.js";

describe("ayah identity resolver", () => {
  it("prefers an explicit reference when textual evidence is comparable", () => {
    const candidates = [
      {
        identity: "2:255",
        confidence: 0.84,
        evidence: [
          { type: "fuzzy-alignment", detail: "partial word alignment" },
          { type: "explicit-reference", detail: "البقرة:255" }
        ] satisfies MatchEvidence[]
      },
      {
        identity: "3:2",
        confidence: 0.84,
        evidence: [
          { type: "fuzzy-alignment", detail: "partial word alignment" }
        ] satisfies MatchEvidence[]
      }
    ];
    const result = resolveAyahIdentity(candidates);
    expect(result?.winner.identity).toBe("2:255");
    expect(result?.ambiguous).toBe(false);
  });

  it("preserves close competing identities as ambiguous", () => {
    const candidates = [
      {
        identity: "2:255",
        confidence: 0.86,
        evidence: [{ type: "fuzzy-alignment", detail: "close match" }] satisfies MatchEvidence[]
      },
      {
        identity: "3:2",
        confidence: 0.84,
        evidence: [{ type: "fuzzy-alignment", detail: "close match" }] satisfies MatchEvidence[]
      }
    ];
    const result = resolveAyahIdentity(candidates);
    expect(result?.ambiguous).toBe(true);
    expect(result?.competing.map(item => item.identity)).toContain("3:2");
  });

  it("rewards independent evidence but never exceeds the score ceiling", () => {
    const score = scoreIdentityCandidate({
      identity: "2:255",
      confidence: 0.99,
      evidence: [
        { type: "exact-text", detail: "exact" },
        { type: "explicit-reference", detail: "reference" },
        { type: "verse-brackets", detail: "brackets" }
      ]
    });
    expect(score).toBeLessThanOrEqual(0.999);
    expect(score).toBeGreaterThan(0.99);
  });

  it("returns no resolution for an empty candidate list", () => {
    expect(resolveAyahIdentity([])).toBeUndefined();
  });
});
