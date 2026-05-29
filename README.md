# Leaderboard

A Chickadee Bandit hub app for tracking wins and ratings across any household competition — video games, foosball, board games, darts, and more.

## Features

- **Custom categories** — create any game with a name, icon, and type (1v1, teams, or co-op)
- **Elo-based ratings** — skill ratings that naturally reward beating stronger opponents and winning with weaker teammates
- **Team games** — foosball, doubles tennis, anything with two sides; all players on a team share the rating outcome
- **Co-op mode** — everyone on the same side (escape rooms, puzzle challenges); success or failure shifts ratings against a fixed baseline
- **Overall leaderboard** — composite rating weighted by games played per category; requires at least 3 games in a category to count
- **Category champions** — at-a-glance view of who leads each game
- **Hub widget** — medium-size widget showing the top-4 on the dashboard

## How Elo handles partner strength

When you win with a weaker partner, your team's average rating is lower, making the win less "expected." The Elo formula credits more points for less-expected wins, so carrying a weak teammate against strong opponents earns more than coasting with a strong partner. No custom code needed — it falls out of the math.

## Development

```bash
npm install
npm run build     # produces dist/bundle.json
npm test          # runs __tests__/logic.test.mjs
bash preflight.sh # build + test (runs automatically on git push)
```

### First-time hook setup

```bash
git config core.hooksPath .githooks
```

## Releasing

Push to `main` or publish a GitHub release — the CI workflow builds `dist/bundle.json` and attaches it to the release. Install from the Chickadee Bandit marketplace using the bundle URL.

## Schema

Four tables in the app's isolated Postgres schema:

| Table | Purpose |
|---|---|
| `lb_categories` | Custom game categories (name, icon, type) |
| `lb_matches` | Match records with timestamp and optional notes |
| `lb_participants` | Per-player match results and rating snapshots |
| `lb_ratings` | Live per-member, per-category Elo ratings and W/L record |
