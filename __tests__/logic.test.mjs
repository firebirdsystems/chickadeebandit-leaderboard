import { describe, it, expect } from "vitest";
import {
  expectedScore,
  teamRating,
  calcMatchDeltas,
  calcFfaDeltas,
  compositeRating,
  buildOverallRankings,
  categoryChampions,
  rankLabel,
  formatRating,
  gameTypeLabel,
  DEFAULT_RATING,
  K_FACTOR,
  MIN_GAMES_FOR_COMPOSITE,
} from "../src/logic.js";

// ── expectedScore ─────────────────────────────────────────────────────────────

describe("expectedScore", () => {
  it("returns 0.5 for equal ratings", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it("returns >0.5 when first player is higher rated", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
  });

  it("returns <0.5 when first player is lower rated", () => {
    expect(expectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it("approaches 1 for a massive rating advantage", () => {
    expect(expectedScore(3000, 1000)).toBeCloseTo(1, 1);
  });

  it("approaches 0 for a massive rating disadvantage", () => {
    expect(expectedScore(1000, 3000)).toBeCloseTo(0, 1);
  });

  it("is symmetric: expectedScore(a,b) + expectedScore(b,a) === 1", () => {
    expect(expectedScore(1100, 950) + expectedScore(950, 1100)).toBeCloseTo(1);
  });
});

// ── teamRating ────────────────────────────────────────────────────────────────

describe("teamRating", () => {
  it("returns DEFAULT_RATING for an empty team", () => {
    expect(teamRating([])).toBe(DEFAULT_RATING);
  });

  it("returns the single rating for a solo player", () => {
    expect(teamRating([1200])).toBe(1200);
  });

  it("averages two ratings", () => {
    expect(teamRating([1200, 800])).toBe(1000);
  });

  it("averages three ratings", () => {
    expect(teamRating([900, 1000, 1100])).toBeCloseTo(1000);
  });
});

// ── calcMatchDeltas ───────────────────────────────────────────────────────────

describe("calcMatchDeltas — 1v1", () => {
  const p1 = { memberId: "p1", rating: 1000 };
  const p2 = { memberId: "p2", rating: 1000 };

  it("winner gains points and loser loses the same amount", () => {
    const deltas = calcMatchDeltas([p1], [p2], "A");
    const d1 = deltas.find(d => d.memberId === "p1");
    const d2 = deltas.find(d => d.memberId === "p2");
    expect(d1.delta).toBeGreaterThan(0);
    expect(d2.delta).toBeLessThan(0);
    expect(d1.delta).toBe(-d2.delta);
  });

  it("returns 4 fields per entry: memberId, ratingBefore, delta", () => {
    const [d] = calcMatchDeltas([p1], [p2], "A");
    expect(d).toHaveProperty("memberId");
    expect(d).toHaveProperty("ratingBefore");
    expect(d).toHaveProperty("delta");
  });

  it("upset win earns more than expected win", () => {
    const strong = { memberId: "strong", rating: 1400 };
    const weak   = { memberId: "weak",   rating: 600  };
    const upsetDeltas   = calcMatchDeltas([weak],   [strong], "A");
    const expectedDeltas = calcMatchDeltas([strong], [weak],   "A");
    expect(upsetDeltas[0].delta).toBeGreaterThan(expectedDeltas[0].delta);
  });

  it("draw gives both players roughly half K points", () => {
    const deltas = calcMatchDeltas([p1], [p2], "draw");
    deltas.forEach(d => expect(d.delta).toBe(0));
  });
});

describe("calcMatchDeltas — 2v2 team game", () => {
  const strong = { memberId: "strong", rating: 1300 };
  const weak   = { memberId: "weak",   rating: 700  };
  const opp1   = { memberId: "opp1",   rating: 1000 };
  const opp2   = { memberId: "opp2",   rating: 1000 };

  it("winning with a weaker partner earns more than winning with a strong partner", () => {
    // Team: strong (1300) + weak (700) = avg 1000 vs opponents avg 1000 — even match
    const evenDeltas = calcMatchDeltas([strong, weak], [opp1, opp2], "A");

    // Team: strong (1300) + clone (1300) = avg 1300 vs same opponents — favored
    const clone = { memberId: "clone", rating: 1300 };
    const favoredDeltas = calcMatchDeltas([strong, clone], [opp1, opp2], "A");

    const strongEven   = evenDeltas.find(d => d.memberId === "strong").delta;
    const strongFavored = favoredDeltas.find(d => d.memberId === "strong").delta;

    // Winning with weak partner (even odds) earns more than winning as heavy favorite
    expect(strongEven).toBeGreaterThan(strongFavored);
  });

  it("all winners gain points, all losers lose points", () => {
    const deltas = calcMatchDeltas([strong, weak], [opp1, opp2], "A");
    const winners = deltas.filter(d => ["strong", "weak"].includes(d.memberId));
    const losers  = deltas.filter(d => ["opp1", "opp2"].includes(d.memberId));
    winners.forEach(d => expect(d.delta).toBeGreaterThan(0));
    losers.forEach(d => expect(d.delta).toBeLessThan(0));
  });

  it("returns deltas for all 4 players", () => {
    const deltas = calcMatchDeltas([strong, weak], [opp1, opp2], "B");
    expect(deltas).toHaveLength(4);
  });
});

describe("calcMatchDeltas — cooperative", () => {
  const p1 = { memberId: "p1", rating: 1000 };
  const p2 = { memberId: "p2", rating: 800  };

  it("both players gain points on success", () => {
    const deltas = calcMatchDeltas([p1, p2], [], "A", true);
    deltas.forEach(d => expect(d.delta).toBeGreaterThan(0));
  });

  it("both players lose points on failure", () => {
    const deltas = calcMatchDeltas([p1, p2], [], "B", true);
    deltas.forEach(d => expect(d.delta).toBeLessThan(0));
  });

  it("a lower-rated player gains more on success than a higher-rated one", () => {
    const deltas = calcMatchDeltas([p1, p2], [], "A", true);
    const d1 = deltas.find(d => d.memberId === "p1").delta;
    const d2 = deltas.find(d => d.memberId === "p2").delta;
    expect(d2).toBeGreaterThan(d1);
  });
});

// ── calcFfaDeltas ─────────────────────────────────────────────────────────────

describe("calcFfaDeltas", () => {
  const winner = { memberId: "winner", rating: 1000 };
  const second = { memberId: "second", rating: 1000 };
  const third  = { memberId: "third",  rating: 1000 };

  it("returns empty array for fewer than 2 players", () => {
    expect(calcFfaDeltas([])).toEqual([]);
    expect(calcFfaDeltas([winner])).toEqual([]);
  });

  it("returns a delta for every player", () => {
    const deltas = calcFfaDeltas([winner, second, third]);
    expect(deltas).toHaveLength(3);
  });

  it("winner gains points, all others lose points", () => {
    const deltas = calcFfaDeltas([winner, second, third]);
    const winnerDelta = deltas.find(d => d.memberId === "winner").delta;
    const secondDelta = deltas.find(d => d.memberId === "second").delta;
    const thirdDelta  = deltas.find(d => d.memberId === "third").delta;
    expect(winnerDelta).toBeGreaterThan(0);
    expect(secondDelta).toBeLessThan(0);
    expect(thirdDelta).toBeLessThan(0);
  });

  it("winner earns more when beating a higher-rated field", () => {
    const strongField  = [{ memberId: "w", rating: 800 }, { memberId: "a", rating: 1200 }, { memberId: "b", rating: 1200 }];
    const weakField    = [{ memberId: "w", rating: 800 }, { memberId: "a", rating: 600  }, { memberId: "b", rating: 600  }];
    const strongDeltas = calcFfaDeltas(strongField).find(d => d.memberId === "w").delta;
    const weakDeltas   = calcFfaDeltas(weakField).find(d => d.memberId === "w").delta;
    expect(strongDeltas).toBeGreaterThan(weakDeltas);
  });

  it("ratingBefore is preserved on each delta", () => {
    const players = [
      { memberId: "a", rating: 1100 },
      { memberId: "b", rating: 900  },
    ];
    const deltas = calcFfaDeltas(players);
    expect(deltas.find(d => d.memberId === "a").ratingBefore).toBe(1100);
    expect(deltas.find(d => d.memberId === "b").ratingBefore).toBe(900);
  });

  it("works correctly for a 2-player FFA (same as 1v1)", () => {
    const p1 = { memberId: "p1", rating: 1000 };
    const p2 = { memberId: "p2", rating: 1000 };
    const ffaDeltas = calcFfaDeltas([p1, p2]);
    const v1Deltas  = calcMatchDeltas([p1], [p2], "A");
    expect(ffaDeltas.find(d => d.memberId === "p1").delta)
      .toBe(v1Deltas.find(d => d.memberId === "p1").delta);
    expect(ffaDeltas.find(d => d.memberId === "p2").delta)
      .toBe(v1Deltas.find(d => d.memberId === "p2").delta);
  });
});

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
