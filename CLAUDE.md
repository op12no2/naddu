## overview

Naddu is a simple UCI Javascript chess engine. 

It's designed to be used in web pages and easily tweaked by users.

However it can be used on the command line via `Node` and `Bun` and `Bun`
can be used to create binaries.

## test

`releases/naddu.js` contains the reference version we are aiming to improve.

- `node naddu.js q` check for syntax errors
- `node naddu.js bench` - total nodes and nps over 50 positions
- `node naddu.js ucinewgame "position startpos" "perft 5"` expected nodes = 4865609
- `node naddu.js "position fen <fen>" "eval"` show eval of <fen>
- `node naddu.js "position fen <fen>" "board"` show board for <fen>
- `node naddu.js "position startpos" "board"` show startpos board
- `node naddu.js et` eval tests (very quick)
- `node naddu.js pt` perft tests (takes ~8 mins)
- `node tooling/example.js examples/mates.html` run an example page in headless chromium and print its results

## examples

`examples/*.html` are for users and double as tests. Each is a standalone page using the Worker
(`new Worker('../naddu.js')`). Test pages fill `#results` and `#summary` ("n of m passed") so that
`tooling/example.js` can run them. Keep them vanilla and in the same style as `hello_world.html`.

## match testing

`./tooling/match.sh` is the acceptance test: an SPRT at 10+0.1, `naddu.js` v `releases/naddu.js`, via fastchess
using bun binaries. Bounds elo0 0 elo1 5, alpha 0.05, beta 0.1 (a loser fails fast), normalized model, capped at
20000 games. Accept on H1. Only ever test at this control, no longer ones. Test per feature. PGN is saved to
`tooling/match.pgn`. The tc was 1+0.1 and fixed 2000 game matches until Sep 15 2026, the results in the todo notes
are from that.

- `./tooling/match.sh` the sprt
- `ROUNDS=4 CONCURRENCY=8 ./tooling/match.sh` quick 8 game smoke test
- `ELO0=-5 ELO1=0 ./tooling/match.sh` non regression bounds for a patch that buys something other than Elo
- extra args are passed to fastchess
- speed-only patches (bench node count unchanged) don't need a match, compare bench nps
- `BASE=/path/to/engine ./tooling/match.sh` plays dev against any uci engine; `TIMEMARGIN=2500` for engines that overshoot the clock
- `node tooling/apply.js lines.txt` writes pst, feature and search lines (the tuner and walk output) into the defaults in `naddu.js`, then match as usual; the live values are filled from those defaults at startup so each has one home

Strength estimate (Sep 3 2026, engine at commit aec6051, 2+0.2, 2000 games each, vs Stash with the user's ratings
14=2058 15=2173 17=2297 18=2380): +260, +171, +92, +7 => about 2350 at this tc. Old Stash versions lose on time at 1+0.1,
hence 2+0.2 and the margin. At 10+0.1 v Stash 18 it was +52 +/- 14 (2000 games), i.e. about 2430, so the js speed
handicap is worth ~45 Elo between those controls. Sep 15 2026: the PeSTO eval was replaced by values tuned from
zero (examples/tuner.html on examples/quiet-labeled.epd, 5000 epochs): -15 +/- 21 v the PeSTO release after 667 games
at 10+0.1, accepted by the user for the sake of Naddu's own values; README says about 2000 until regauged. Fastchess hangs after the last games of a match; kill it and the result
stands. Gauntlet pgns are in releases/.

## git workflow

Claude is free to commit and push without asking. Put the match result in the commit message.
When pushing, first copy `naddu.js` to `releases/naddu.js` so the release is always the pushed
engine and the next match measures only the next feature.

## data structures

- WHITE, BLACK: 0, 8
- PAWN to KING: 1 to 6
- board: 0x88 
- moves: `(from square << 8) | to square | flags`
- TT uses 2 x Uint32 typed arrays

## useful expressions

- get piece type: `piece & 0x7`
- get piece color: `piece & BLACK`
- toggle color: `color ^ BLACK`
- get 0,1 index from color: `color >> 3`
- toggle colour index: `colorIndex ^ 1`
- get to square from move: `move & 0xff`
- get from square from move: `(move >> 8) & 0xff`
- encode move: `(from << 8) | to | flags`
- feel free to assume WHITE is 0, i.e. `if (color)` is ok.

## coding conventions

- well commented but terse not mannered
- 2 space indentation
- put `else`, `return`, `continue`, `break` on next line
- don't use `var`, `map` and `=>` or other fancy/new techniques
- use typed arrays when possible
- clean and KISS but keep performance in mind

## performance

- avoid local arrays and objects
- use (global) typed arrays for performance if relevant

## todo

- proper 3 positioin draw detection
- add the uci command to change tt size - with a default of 16Mb.
- passed pawns in eval - tried Sep 2026 (per-file rank tracking, bonus 0/0/5/10/20/40/60 mg, 0/5/15/30/50/85/130 eg by rank): -19 +/- 12 Elo, rejected. PeSTO PSTs already reward advanced pawns and eval got 30% slower. A retry needs a different design, not smaller numbers.
- mobility in eval - tried Sep 2026 together with fruit-style king zone attacks (one ray walk per piece in evaluate, mobility relative to a baseline, N/B/R/Q attack units 2/2/3/5 with a weight by attacker count): -24 +/- 12 Elo, rejected. The ray walk costs ~37% nps and the terms did not earn it back at 1+0.1. Any retry needs attack tables or a much cheaper approximation.
- king safety in eval - pawn shelter v1 (0/8/16/25 by pawn distance, always on): -11 +/- 12, rejected. v2 (halved to 0/4/8/12, only while the opponent has a queen): +6 +/- 12, accepted Sep 2026. The attack half needs mobility-style ray walking which costs ~37% nps, see mobility.
- eval tuned from zero - Sep 15 2026, see the strength note above. The tuned values include non zero smother and cuddle, so the second board walk is on and nps is ~20% lower than with them at zero; a cheap step mobility term (free first steps per piece, no ray walks) is the next idea, to be tuned the same way.
- king tropism (smother) - tried Sep 15 2026 as `feature smother mg 3 2 2 4`, bonus per king step closer to the enemy king for N B R Q: -37 +/- 24 after 200 games at 10+0.1, stopped early by the user, defaults left at zero. The terms cost ~20% nps when on (a second board walk). They stay as style knobs, see the feature command.
- lmp - tried Sep 2026 (non-PV, depth <= 3, skip quiet moves after 3 + 3*depth*depth): -4 +/- 11 Elo, neutral, left out as not worth the code on top of futility pruning

always add a link to the chess programming wiki when adding a new feature.

## references

- UCI protocol - https://backscattering.de/chess/uci/
- 0x88 board - https://www.chessprogramming.org/0x88

