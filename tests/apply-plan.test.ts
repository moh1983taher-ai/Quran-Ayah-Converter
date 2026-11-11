import { describe, expect, it } from "vitest";
import { createWordApplyPlan } from "../src/word/apply-plan.js";
import type { QuranCitationReview } from "../src/word/quran-citation.js";

const expectedCitation = "[المؤمنون: 5–7]";

function review(
  status: QuranCitationReview["status"],
  overrides: Partial<QuranCitationReview> = {}
): QuranCitationReview {
  return {
    status,
    expectedCitation,
    editable: status === "missing" || status === "incorrect" || status === "correct",
    detail: status,
    ...overrides
  };
}

describe("independent Word apply plan", () => {
  it("converts the verse without touching citations when conversion alone is selected", () => {
    expect(createWordApplyPlan({
      convertVerse: true,
      addMissingCitation: false,
      correctExistingCitation: false,
      review: review("incorrect", {
        existingCitation: "[المعارج: 29–31]",
        start: 30,
        end: 52
      }),
      expectedCitation
    })).toEqual({
      convertVerse: true,
      citationEdit: { kind: "none" }
    });
  });

  it("adds a missing citation without enabling verse conversion", () => {
    expect(createWordApplyPlan({
      convertVerse: false,
      addMissingCitation: true,
      correctExistingCitation: false,
      review: review("missing", { separator: "، " }),
      expectedCitation
    })).toEqual({
      convertVerse: false,
      citationEdit: {
        kind: "insert",
        text: expectedCitation,
        separator: "، "
      }
    });
  });

  it("corrects only the citation range without enabling verse conversion", () => {
    expect(createWordApplyPlan({
      convertVerse: false,
      addMissingCitation: false,
      correctExistingCitation: true,
      review: review("incorrect", {
        existingCitation: "[المعارج: 29–31]",
        separator: " ",
        start: 42,
        end: 64
      }),
      expectedCitation
    })).toEqual({
      convertVerse: false,
      citationEdit: {
        kind: "replace",
        text: expectedCitation,
        start: 42,
        end: 64
      }
    });
  });

  it("supports combining verse conversion with citation correction", () => {
    expect(createWordApplyPlan({
      convertVerse: true,
      addMissingCitation: false,
      correctExistingCitation: true,
      review: review("incorrect", { start: 12, end: 25 }),
      expectedCitation
    })).toEqual({
      convertVerse: true,
      citationEdit: { kind: "replace", text: expectedCitation, start: 12, end: 25 }
    });
  });

  it("never adds a missing citation in verification-and-correction mode", () => {
    expect(createWordApplyPlan({
      convertVerse: false,
      addMissingCitation: true,
      correctExistingCitation: true,
      review: review("missing"),
      expectedCitation
    })).toEqual({
      convertVerse: false,
      citationEdit: { kind: "none" }
    });
  });

  it("does not correct a wrong citation in add-only mode", () => {
    expect(createWordApplyPlan({
      convertVerse: false,
      addMissingCitation: true,
      correctExistingCitation: false,
      review: review("incorrect", { start: 12, end: 25 }),
      expectedCitation
    })).toEqual({
      convertVerse: false,
      citationEdit: { kind: "none" }
    });
  });

  it("leaves correct, ambiguous, out-of-scope and unavailable citations untouched", () => {
    for (const status of ["correct", "ambiguous", "outside-scope", "unavailable"] as const) {
      expect(createWordApplyPlan({
        convertVerse: false,
        addMissingCitation: true,
        correctExistingCitation: true,
        review: review(status, { editable: false, start: 12, end: 25 }),
        expectedCitation
      }).citationEdit).toEqual({ kind: "none" });
    }
  });

  it("does not create a citation correction without a validated range", () => {
    expect(createWordApplyPlan({
      convertVerse: false,
      addMissingCitation: false,
      correctExistingCitation: true,
      review: review("incorrect"),
      expectedCitation
    }).citationEdit).toEqual({ kind: "none" });
  });
});
