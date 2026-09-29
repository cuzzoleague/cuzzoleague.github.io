# Cuzzo League

A stats site for our Sleeper fantasy football league, hosted on GitHub Pages. It's a static site
with no backend: the browser pulls everything live from the public Sleeper and ESPN feeds.

## What's on it

**League tab**
- **Power rankings**: a 0–100 power score (40% all-play win rate, 35% scoring strength, 25% recent form), plus a team report with expected wins, schedule luck, all-play record, and simulated playoff and bye odds.
- **Weekly hardware**: awards like Top Dog, Heartbreak Hotel, Horseshoe, Steady Eddie, and Bench Blunder.
- **Scoring heatmap**, **schedule swap** matrix, and **scoring ranges** (floor, average, and ceiling for each team).
- **Trade & waiver grades**: each week's best possible lineup with and without a move.
- **Power movement**: a bump chart of weekly power ranks.
- **All-time leaderboard**: every linked Sleeper season, with champions, records, points per game, and a sortable legacy score.

**Matchups tab**
- Opens on the current week and follows Sleeper's week as the season goes. A dropdown picks any past, current, future, or playoff week.
- Every matchup shows records, projected or final scores, and win odds. Games with odds between 42% and 58% are highlighted in gold as coin flips. Finished weeks show the pregame odds and flag upsets.
- **Fantasy play-by-play**: pick a matchup and you get both lineups with live NFL game status, plus a feed of every NFL play involving those starters and the fantasy points each play produced. While games are live it refreshes every 30 seconds.

## Adding the league photo

Save the image as `site/assets/hero.jpg`. It shows up in the banner automatically, and until then a
placeholder is shown.

## Running it locally

```bash
npm run serve
```

Then open http://localhost:8080. The site uses ES modules, so it needs to be served over HTTP;
opening `index.html` directly won't work. Tests run with `npm test` (Node 20+).

## Deploying

1. Create a GitHub repo and push this folder to its `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs the tests and publishes the `site/` folder. The URL appears in the Actions run and on the Pages settings screen.

## New season

When Sleeper renews the league it gets a new league ID. Update `LEAGUE_ID` in `site/js/config.js`.
Older seasons are found automatically through Sleeper's `previous_league_id` chain.

## How the numbers work

- **Win odds** add up each starter's Sleeper projection (scored with this league's settings) and treat
  each player as uncertain, with a spread of about half their projection. During games, a player's
  remaining projection shrinks as their NFL game clock runs down, and live points come from Sleeper.
- **Play-by-play points** are estimated from ESPN play descriptions using the league's scoring. Checked
  against Sleeper's official totals for every starter in Week 3 of 2026, receivers and tight ends matched
  exactly, and QBs and running backs were off by about 0.1 point on average. The only real gaps are
  things that aren't tied to a single play, such as a D/ST's points-allowed bonus. The lineup totals
  shown next to the feed always come from Sleeper.
- **Playoff odds** simulate the remaining regular season 4,000 times using the real schedule. Seeding
  is by record, then points for.
