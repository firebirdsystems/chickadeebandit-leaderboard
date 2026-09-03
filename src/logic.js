// Pure business logic — no DOM, no fetch.
//
// SCORING IS NOT HERE. The Elo fold lives in `manifest.write_effects` on
// lb_matches, as SQL the hub appends to the match INSERT's own transaction:
// "fold_participant_ratings" fills each participant's rating_before /
// rating_after, and "fold_ratings" folds them into lb_ratings.
//
// It used to live in this file, and it could not stay: every open client
// ingests events, so two matches read the same starting ratings and computed
// their movement from the same stale base, and lb_ratings was member_writable,
// so any member could write themselves a rating outright. Neither is fixable
// from the browser. A JS copy kept here "for reference" would be a second
// definition of the same rule, free to drift from the one that actually runs —
// so there is exactly one, and it is in the manifest.
//
// What remains below is DISPLAY logic over ratings already computed.

// The 1000 a first-time player starts from is NOT declared here. It lives in
// "fold_participant_ratings" and "fold_ratings" (manifest.write_effects),
// which are the only things that assign it — a constant in this file would be
// a second spelling of the same number, free to drift from the one that runs.
export const MIN_GAMES_FOR_COMPOSITE = 3;

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
