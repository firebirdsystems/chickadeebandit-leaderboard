// Pure business logic — no DOM, no fetch.

export const DEFAULT_RATING = 1000;
export const K_FACTOR = 32;
export const MIN_GAMES_FOR_COMPOSITE = 3;

/**
 * Expected win probability for a player/team rated `ratingA` vs `ratingB`.
 */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Average rating for a team (array of numeric ratings).
 */
export function teamRating(ratings) {
  if (!ratings.length) return DEFAULT_RATING;
  return ratings.reduce((s, r) => s + r, 0) / ratings.length;
}

/**
 * Compute per-player Elo deltas for a two-sided match.
 *
 * teamA / teamB: Array<{ memberId: string, rating: number }>
 * winningSide: 'A' | 'B' | 'draw'
 * cooperative: both sides treated as winners vs a baseline opponent
 *
 * Returns Array<{ memberId, ratingBefore, delta }>
 */
export function calcMatchDeltas(teamA, teamB, winningSide, cooperative = false) {
  if (cooperative) {
    const baseline = DEFAULT_RATING;
    const score = winningSide === "A" ? 1 : 0;
    return [...teamA, ...teamB].map(p => {
      const delta = Math.round(K_FACTOR * (score - expectedScore(p.rating, baseline)));
      return { memberId: p.memberId, ratingBefore: p.rating, delta };
    });
  }

  const avgA = teamRating(teamA.map(p => p.rating));
  const avgB = teamRating(teamB.map(p => p.rating));

  const scoreA = winningSide === 'A' ? 1 : winningSide === 'draw' ? 0.5 : 0;
  const scoreB = 1 - scoreA;

  const deltasA = teamA.map(p => ({
    memberId: p.memberId,
    ratingBefore: p.rating,
    delta: Math.round(K_FACTOR * (scoreA - expectedScore(avgA, avgB))),
  }));
  const deltasB = teamB.map(p => ({
    memberId: p.memberId,
    ratingBefore: p.rating,
    delta: Math.round(K_FACTOR * (scoreB - expectedScore(avgB, avgA))),
  }));

  return [...deltasA, ...deltasB];
}

/**
 * Composite rating across categories.
 * Each category is weighted by games_played; categories with fewer than
 * MIN_GAMES_FOR_COMPOSITE games are excluded to avoid noise.
 *
 * memberRatings: Array<{ categoryId, rating, gamesPlayed }>
 * Returns a rounded integer rating, or null if no qualifying categories.
 */
export function compositeRating(memberRatings) {
  const qualifying = memberRatings.filter(r => r.gamesPlayed >= MIN_GAMES_FOR_COMPOSITE);
  if (!qualifying.length) return null;
  const totalGames = qualifying.reduce((s, r) => s + r.gamesPlayed, 0);
  const weighted = qualifying.reduce((s, r) => s + r.rating * r.gamesPlayed, 0);
  return Math.round(weighted / totalGames);
}

/**
 * Sort members by composite rating descending, then by total games played.
 * Members with no composite rating (too few games) appear last.
 *
 * members: Array<{ id, name, ... }>
 * ratingsByMember: Map<memberId, Array<{ categoryId, rating, gamesPlayed }>>
 * Returns sorted Array<{ member, composite, totalGames, categoryRatings }>
 */
export function buildOverallRankings(members, ratingsByMember) {
  return members
    .map(member => {
      const categoryRatings = ratingsByMember.get(member.id) ?? [];
      const composite = compositeRating(categoryRatings);
      const totalGames = categoryRatings.reduce((s, r) => s + r.gamesPlayed, 0);
      return { member, composite, totalGames, categoryRatings };
    })
    .sort((a, b) => {
      if (a.composite !== null && b.composite === null) return -1;
      if (a.composite === null && b.composite !== null) return 1;
      if (a.composite !== null && b.composite !== null) return b.composite - a.composite;
      return b.totalGames - a.totalGames;
    });
}

/**
 * Find the category champion (highest rated player) for each category.
 * Returns Map<categoryId, { memberId, rating }>
 */
export function categoryChampions(allRatings) {
  const champions = new Map();
  for (const r of allRatings) {
    const current = champions.get(r.category_id);
    if (!current || r.rating > current.rating) {
      champions.set(r.category_id, { memberId: r.member_id, rating: r.rating });
    }
  }
  return champions;
}

/**
 * Compute Elo deltas for a free-for-all result (e.g. Quiet Time).
 * Treats the winner as Team A vs. all other ranked players as Team B.
 * Requires at least 2 players. Returns [] for a single-player result.
 *
 * rankedPlayers: Array<{ memberId, rating }> sorted best-first (index 0 = winner)
 */
export function calcFfaDeltas(rankedPlayers) {
  if (rankedPlayers.length < 2) return [];
  const [winner, ...rest] = rankedPlayers;
  return calcMatchDeltas([winner], rest, "A");
}

/**
 * Rank label for a zero-based index: medals for top 3, numbers after.
 */
export function rankLabel(index) {
  return ["🥇", "🥈", "🥉"][index] ?? String(index + 1);
}

/**
 * Format a rating number for display.
 */
export function formatRating(rating) {
  return rating != null ? Math.round(rating).toLocaleString() : "—";
}

/**
 * Human-readable label for a game type.
 */
export function gameTypeLabel(gameType) {
  return { "1v1": "1 vs 1", team: "Teams", cooperative: "Co-op" }[gameType] ?? gameType;
}
