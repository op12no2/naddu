## overview

Naddu is a simple UCI Javascript chess engine. 

It's designed to be used in web pages and easily tweaked by users.

However it can be used on the command line via `Node` and `Bun` and `Bun`
can be used to create binaries.

I do not want Naddu to get bloated and complicated.

I am not primarily chasing Elo, but more Elo is always nice.

Simplicity is just as important.

We can possibly create complex extra-naddu.js tooling to
test, evaluate or even train the resulting simplicity within Naddu.
But we do not expose to the user; i.e. keep it out of the repo.

I like the repo being `naddu.js` and `naddu.html`.

## test

- `node naddu.js q` check for syntax errors
- `node naddu.js bench` - total nodes and nps over 50 positions
- `node naddu.js ucinewgame "position startpos" "perft 5"` expected nodes = 4865609
- `node naddu.js "position fen <fen>" "eval"` show eval of <fen>
- `node naddu.js "position fen <fen>" "board"` show board for <fen>
- `node naddu.js "position startpos" "board"` show startpos board
- `node naddu.js et` eval tests (very quick)
- `node naddu.js pt` perft tests (takes ~8 mins)

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

- passed pawns in eval
- mobility in eval
- king safety in eval
- aspiration window to go()
- lmr
- lmp
- futility pruning
- auto init to new game and startpos
- if go arrives before any ucinewgame or position, behave as if both had been sent
- if go arrives alone do a 100ms search

## claude suggestions

 1. Soft time limit in the go loop. Right now the search runs iterations until the hard deadline and then throws away
     the partial iteration. Skipping the next iteration when more than roughly half the budget is used keeps the engine
     from wasting time and lets you allocate a bit more per move. This is the biggest cheap strength gain available and
     doesn't touch search.
  2. Null move pruning. Already on your todo. Around ten lines and typically the biggest single search win after the TT.
     Needs a "no null move twice in a row" flag on the node and a skip when the side to move has only pawns.
  3. Late move reductions. Also on your todo. Reduce quiet, non-killer, non-check moves after the first few by one ply
     at depth 3 or more, re-search at full depth if they beat alpha. The move ordering stages you already have make this
     easy.
  4. Aspiration windows. Small gain, small code, but comes after the two above because those change the score behaviour.
  5. Passed pawns in eval. The one eval feature that reliably moves the needle in a PST-only engine. Mobility and king
     safety are bigger code and noisier to test.

## references

- UCI protocol - https://backscattering.de/chess/uci/
- 0x88 board - https://www.chessprogramming.org/0x88

