import { describe, it, expect } from "vitest";
import {
  compositeRating,
  buildOverallRankings,
  categoryChampions,
  rankLabel,
  formatRating,
  gameTypeLabel,
  MIN_GAMES_FOR_COMPOSITE,
} from "../src/logic.js";

// ── compositeRating ───────────────────────────────────────────────────────────

describe("compositeRating", () => {
  it("returns null when no categories have enough games", () => {
    const ratings = [
      { categoryId: "c1", rating: 1200, gamesPlayed: 2 },
    ];
    expect(compositeRating(ratings)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(compositeRating([])).toBeNull();
  });

  it("returns the single qualifying category rating", () => {
    const ratings = [{ categoryId: "c1", rating: 1150, gamesPlayed: 5 }];
    expect(compositeRating(ratings)).toBe(1150);
  });

  it("weights by games_played, not a simple average", () => {
    const ratings = [
      { categoryId: "c1", rating: 1100, gamesPlayed: 10 },
      { categoryId: "c2", rating: 900,  gamesPlayed: 10 },
    ];
    expect(compositeRating(ratings)).toBe(1000);
  });

  it("categories with more games pull the composite toward their rating", () => {
    const ratings = [
      { categoryId: "c1", rating: 1100, gamesPlayed: 9 },
      { categoryId: "c2", rating: 800,  gamesPlayed: 3 },
    ];
    // weighted: (1100*9 + 800*3) / 12 = (9900+2400)/12 = 1025
    expect(compositeRating(ratings)).toBe(1025);
  });

  it("ignores categories with fewer than MIN_GAMES_FOR_COMPOSITE games", () => {
    const ratings = [
      { categoryId: "c1", rating: 1200, gamesPlayed: MIN_GAMES_FOR_COMPOSITE - 1 },
      { categoryId: "c2", rating: 900,  gamesPlayed: MIN_GAMES_FOR_COMPOSITE },
    ];
    expect(compositeRating(ratings)).toBe(900);
  });
});

// ── buildOverallRankings ──────────────────────────────────────────────────────

const MEMBERS = [
  { id: "alice", name: "Alice" },
  { id: "bob",   name: "Bob"   },
  { id: "carol", name: "Carol" },
];

describe("buildOverallRankings", () => {
  it("returns an entry for every member", () => {
    const result = buildOverallRankings(MEMBERS, new Map());
    expect(result).toHaveLength(3);
  });

  it("places members with composite ratings before those without", () => {
    const ratingsByMember = new Map([
      ["alice", [{ categoryId: "c1", rating: 1100, gamesPlayed: 5 }]],
    ]);
    const result = buildOverallRankings(MEMBERS, ratingsByMember);
    expect(result[0].member.id).toBe("alice");
  });

  it("sorts members with composite ratings highest-first", () => {
    const ratingsByMember = new Map([
      ["alice", [{ categoryId: "c1", rating: 1200, gamesPlayed: 5 }]],
      ["bob",   [{ categoryId: "c1", rating: 1050, gamesPlayed: 5 }]],
    ]);
    const result = buildOverallRankings(MEMBERS, ratingsByMember);
    expect(result[0].member.id).toBe("alice");
    expect(result[1].member.id).toBe("bob");
  });

  it("includes totalGames and categoryRatings in each entry", () => {
    const ratingsByMember = new Map([
      ["alice", [{ categoryId: "c1", rating: 1100, gamesPlayed: 7 }]],
    ]);
    const [alice] = buildOverallRankings(MEMBERS, ratingsByMember);
    expect(alice.totalGames).toBe(7);
    expect(alice.categoryRatings).toHaveLength(1);
  });

  it("gives null composite to members with no qualifying categories", () => {
    const ratingsByMember = new Map([
      ["alice", [{ categoryId: "c1", rating: 1100, gamesPlayed: 1 }]],
    ]);
    const [alice] = buildOverallRankings(MEMBERS, ratingsByMember);
    expect(alice.composite).toBeNull();
  });
});

// ── categoryChampions ─────────────────────────────────────────────────────────

describe("categoryChampions", () => {
  it("returns empty map for no ratings", () => {
    expect(categoryChampions([])).toEqual(new Map());
  });

  it("identifies the highest-rated player per category", () => {
    const rows = [
      { member_id: "alice", category_id: "foosball", rating: 1200 },
      { member_id: "bob",   category_id: "foosball", rating: 1050 },
      { member_id: "bob",   category_id: "chess",    rating: 1300 },
      { member_id: "alice", category_id: "chess",    rating: 1100 },
    ];
    const champs = categoryChampions(rows);
    expect(champs.get("foosball").memberId).toBe("alice");
    expect(champs.get("chess").memberId).toBe("bob");
  });

  it("handles single entry per category", () => {
    const rows = [{ member_id: "alice", category_id: "darts", rating: 999 }];
    expect(categoryChampions(rows).get("darts").memberId).toBe("alice");
  });
});

// ── rankLabel ─────────────────────────────────────────────────────────────────

describe("rankLabel", () => {
  it("returns 🥇 for index 0", () => expect(rankLabel(0)).toBe("🥇"));
  it("returns 🥈 for index 1", () => expect(rankLabel(1)).toBe("🥈"));
  it("returns 🥉 for index 2", () => expect(rankLabel(2)).toBe("🥉"));
  it("returns '4' for index 3", () => expect(rankLabel(3)).toBe("4"));
  it("returns '10' for index 9", () => expect(rankLabel(9)).toBe("10"));
});

// ── formatRating ──────────────────────────────────────────────────────────────

describe("formatRating", () => {
  it("returns '—' for null", () => expect(formatRating(null)).toBe("—"));
  it("rounds and formats 1234.7 as '1,235'", () => expect(formatRating(1234.7)).toBe("1,235"));
  it("rounds and formats 999.4 as '999'", () => expect(formatRating(999.4)).toBe("999"));
  it("formats 1000 as '1,000'", () => expect(formatRating(1000)).toBe("1,000"));
});

// ── gameTypeLabel ─────────────────────────────────────────────────────────────

describe("gameTypeLabel", () => {
  it("labels 1v1", () => expect(gameTypeLabel("1v1")).toBe("1 vs 1"));
  it("labels team", () => expect(gameTypeLabel("team")).toBe("Teams"));
  it("labels cooperative", () => expect(gameTypeLabel("cooperative")).toBe("Co-op"));
  it("falls back to the raw value for unknown types", () => expect(gameTypeLabel("unknown")).toBe("unknown"));
});
