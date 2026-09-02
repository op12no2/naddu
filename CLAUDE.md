## overview

Naddu is a simple UCI Javascript chess engine. 

It's designed to be used in web pages and easily tweaked by users.

However it can be used on the command line via `Node` and `Bun` and `Bun`
can be used to create binaries.

I do not want Naddu to get bloated and complicated.

I am not primarily chasing Elo, but more Elo is always nice.

Simplicity is just as important.

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

`./tooling/match.sh` is the acceptance test: 2000 games at 1+0.1, `naddu.js` v `releases/naddu.js`,
via fastchess using bun binaries. One run, verdict is final, no reruns, no SPRT.
Accept a patch if it is not clearly worse. Test per feature, never tune parameters.
PGN is saved to `tooling/match.pgn` for style analysis.

- `./tooling/match.sh` full 2000 game match (~20 mins)
- `ROUNDS=4 CONCURRENCY=8 ./tooling/match.sh` quick 8 game smoke test
- extra args are passed to fastchess
- speed-only patches (bench node count unchanged) don't need a match, compare bench nps

## git workflow

Claude is free to commit and push without asking. Put the match result in the commit message.
When pushing, first copy `naddu.js` to `releases/naddu.js` so the release is always the pushed
engine and the next match measures only the next feature.

## data structures

- WHITE, BLACK: 0, 8
- PAWN to KING: 1 to 6
- board: 0x88 
- moves: `(from square << 8) | to square | flags`
- related files: `node.js`, `pos.js`, `gen.js`
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

- passed pawns in eval - tried Sep 2026 (per-file rank tracking, bonus 0/0/5/10/20/40/60 mg, 0/5/15/30/50/85/130 eg by rank): -19 +/- 12 Elo, rejected. PeSTO PSTs already reward advanced pawns and eval got 30% slower. A retry needs a different design, not smaller numbers.
- mobility in eval
- king safety in eval - pawn shelter tried Sep 2026 (fruit-style, 3 files, penalty 0/8/16/25 by pawn distance, king file x2, mg only): -11 +/- 12 Elo and 5% slower, rejected. The attack half needs mobility-style ray walking which costs ~37% nps, see mobility.
- lmp - tried Sep 2026 (non-PV, depth <= 3, skip quiet moves after 3 + 3*depth*depth): -4 +/- 11 Elo, neutral, left out as not worth the code on top of futility pruning

always add a link to the chess programming wiki when adding a new feature.

## claude suggestions

Soft time limit, null move pruning, lmr and aspiration windows are done (Sep 2026). Passed pawns was tried and
rejected, see todo. Nothing else pending from Claude; mobility and king safety are the next eval candidates but are
bigger code and noisier to test.

## references

- UCI protocol - https://backscattering.de/chess/uci/
- 0x88 board - https://www.chessprogramming.org/0x88

