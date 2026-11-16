# Chess tactics

Practice pages from Al Woolum’s *The Chess Tactics Workbook*, for Inga. The pages are not linked from the homeschool home page.

GitHub Pages only reads `robots.txt` from the domain root (`https://brokkssmidja.github.io/robots.txt`), not from this project site. The copy in the repo is published at `/homeschool/robots.txt` and crawlers do not use it. Each chess page sends `noindex, nofollow`, and that tag is what applies.

## Add a page

1. Photograph the workbook page.
2. Save a downscaled copy as `chess/photos/page-NNN.jpg` (longest side about 1400 pixels).
3. Add `chess/pages/NNN.json`:

```json
{
  "page": 3,
  "title": "Checkmate In One Move",
  "goal": "mate",
  "photo": "photos/page-003.jpg",
  "puzzles": [
    { "id": "1", "fen": "... w - - 0 1", "solutions": ["Qh7#"], "line": ["e4h7"] }
  ]
}
```

`goal` is `mate` or `material`. Six puzzles, white to move. `line` is the main line in UCI, white moves first. For mate, `solutions` lists every mating move in SAN. For material, leave `solutions` out; any move that keeps a clearly winning evaluation is accepted.

4. Add one object to `chess/catalog.json`.
5. Run `python3 scripts/validate_chess.py`. Mate pages must be mate in one. Material pages must be roughly equal at the start and the main line must win at least a piece.
6. Open `#/check/NNN` and compare the photo with the six boards.

## Libraries

`chess.js` is BSD-2-Clause. `chessground` is GPL-3.0-or-later. Stockfish is GPL-3.0. The notices are in `chess/vendor/`.
