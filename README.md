# Naddu

Naddu is a Javascript UCI chess engine.

It can be easily included in your web pages.

All you need is `naddu.js` from the repo root.

The code is written in a straightforward style and deliberately easy to tweak.

Strength is around 2400 Elo.

The hash table defaults to 16 MB and can be set with `setoption name Hash value <mb>`.

## Hello world

```
const naddu = new Worker('naddu.js');
const ucioutput = document.getElementById('ucioutput');

naddu.onmessage = function(e) {
  ucioutput.textContent += e.data + '\n'; // naddu reponds with text as per UCI 
};

naddu.postMessage('uci');
naddu.postMessage('ucinewgame');
naddu.postMessage('position startpos');
naddu.postMessage('board');
naddu.postMessage('eval');
naddu.postMessage('go depth 8');
naddu.postMessage('go movetime 1000')
```

Try this example here: https://op12no2.github.io/naddu/examples/hello_world.html

## More examples

- [mates](https://op12no2.github.io/naddu/examples/mates.html) - finds mates and checks the reported mate distance.
- [console](https://op12no2.github.io/naddu/examples/console.html) - a console, type UCI commands and see the replies, `?` lists them.
- [play](https://op12no2.github.io/naddu/examples/play.html) - play against Naddu at five strength levels, or watch Naddu play itself.
- [endgames](https://op12no2.github.io/naddu/examples/endgames.html) - plays out random K+Q v K and K+R v K positions and checks white mates.
- [analysis](https://op12no2.github.io/naddu/examples/analysis.html) - set up a position by dragging pieces, presets or FEN, then analyse it.
- [openings](https://op12no2.github.io/naddu/examples/openings.html) - twenty workers search each first move deeper and deeper, then rank them.
- [perft](https://op12no2.github.io/naddu/examples/perft.html) - move generator node counts against the known values, plus your own.
- [bk](https://op12no2.github.io/naddu/examples/bk.html) - the Bratko-Kopec test at a search time of your choice.
- [sts](https://op12no2.github.io/naddu/examples/sts.html) - the 1500 position Strategic Test Suite, one worker per theme, to a fixed depth or time, scored overall and per theme.
- [pst](https://op12no2.github.io/naddu/examples/pst.html) - the piece square tables as heat maps on one shared colour scale.
- [taper](https://op12no2.github.io/naddu/examples/taper.html) - one board per piece with a phase slider, showing the blended values the eval really uses.
- [parallel](https://op12no2.github.io/naddu/examples/parallel.html) - workers share out the root moves of one position and search them together.
- [arena](https://op12no2.github.io/naddu/examples/arena.html) - a round robin between the five strength levels, twenty workers, live crosstable.
- [landscape](https://op12no2.github.io/naddu/examples/landscape.html) - a worker per piece tries it on every empty square, heat maps of where the eval would like each piece.
- [game](https://op12no2.github.io/naddu/examples/game.html) - the engine plays itself on a clock with a live score graph, time bars and a deeper second opinion from a worker pool.
- [scaling](https://op12no2.github.io/naddu/examples/scaling.html) - root moves shared out between 1 to 16 workers, speedup plotted against the ideal.
- [deepening](https://op12no2.github.io/naddu/examples/deepening.html) - nodes per iteration and the branching factor charted live for five positions side by side.
- [symmetry](https://op12no2.github.io/naddu/examples/symmetry.html) - eight workers play random games and check every position evals the same when colour flipped.

## UCI commands

UCI is richer than this, these are the commands Naddu implements:-

- `uci` - engine name and author, then `uciok`.
- `isready` - replies `readyok`.
- `ucinewgame` - clears the hash and history, do this before a new game.
- `setoption name Hash value <mb>` - hash table size, default 16.
- `position startpos [moves ...]` and `position fen <fen> [moves ...]`.
- `go depth <n>`, `go nodes <n>`, `go movetime <ms>`, `go infinite` and `go wtime <ms> btime <ms> winc <ms> binc <ms> [movestogo <n>]`.
- `stop` - accepted but does nothing, see below.
- `quit` - exits, in a worker it closes the worker.

A search runs to completion inside the worker and replies with `info` lines and then `bestmove`. Commands sent
while it is searching queue up until it finishes. So `stop` cannot interrupt a search and `go infinite` runs
until the worker is killed. To stop a search, kill the worker and make a new one:-

```
naddu.terminate();
naddu = new Worker('naddu.js');
```

## UCI options

Reported by `uci` and set with `setoption name <name> value <value>`, the name is not case sensitive:-

- `Hash` - hash table size in MB, spin, default 16, min 1, max 1024. Setting it clears the table. The size is
  rounded down to a power of two entries of 16 bytes, so 24 gives the same table as 16.

## UCI extensions

Extra commands handy for web pages and testing, with any shortform in parenthsis:-

- `board` (`b`) - show the current position.
- `moves` (`l`) - list the legal moves, or `checkmate` or `stalemate` if there are none.
- `eval` (`e`) - static eval of the current position from the side to move's point of view.
- `pst` - print, set or reset the piece square tables, see below.
- `feature` - print, set or reset the other eval numbers, tempo, phase weights and so on, see below.
- `perft <depth>` (`f`) - leaf node count.
- `bench` (`h`) - search 50 positions, report nodes and nps.
- `evaltests` (`et`) - evals of the bench positions.
- `perfttests` (`pt`) - the perft test suite, takes a while.
- `?` or `help` - list the commands.

Some standard UCI commands and sub-commands have shortforms too:-

- `ucinewgame` (`u`)
- `position` (`p`) 
- `startpos` (`s`)
- `fen` (`f`)
- `go` (`g`)
- `depth` (`d`)
- `movetime` (`m`)
- `nodes` (`n`)
- `quit` (`q`)

Allowing useful quick sequences like:-

```
u
p s
b
g d 10
q
```

`go` on its own searches for 100 ms.

## Piece square tables

The `pst` command prints, sets and resets the piece square tables, so a page or a script can restyle the engine
without editing it. Any change clears the hash. Not case sensitive.

```
pst
pst def
pst <piece> [mg|eg]
pst <piece> [mg|eg] def
pst <piece> [mg|eg] <sq>
pst <piece> [mg|eg] <sq> <v>
pst <piece> [mg|eg] <v1> <v2> ... <v64>
```

- `<piece>` - `p n b r q k` for both colours, black mirrored, or `wp bn` etc for one colour.
- `mg|eg` - middlegame or endgame table, both if left out.
- `<sq>` - an absolute square, `e4` is e4 for either colour.
- `<v>` - whole centipawns, 64 of them in the order a1 b1 ... h1 a2 ... h8.
- `def` - reset to the PeSTO values.

### Examples

`pst` prints all 24 tables, one line each in the form `pst wn mg <64 values>`, which is exactly the form the set
command takes, so a printed line can be edited and sent back. `pst n` prints the four knight tables and `pst bn eg`
just the black knight endgame table.

`pst n mg e4` prints the middlegame value of a knight on e4 for white and then black, and since no colour was given
the black value is the mirrored square e5. `pst wn e4` prints white's middlegame and endgame values for e4.

`pst n mg e4 25` sets the middlegame value of a knight on e4 to 25 for white and, mirrored, on e5 for black. This
keeps the eval symmetric. `pst bn mg e4 25` sets black's e4 only, which is how you give the two sides different
styles.

`pst n mg -105 -21 -58 ... -107` sets the whole white middlegame knight table and its mirror for black from 64
values, a1 to h8 rank by rank from white's side.

`pst n mg def` resets one table, `pst n def` the four knight tables, `pst def` everything.

## Features

The `feature` command prints, sets and resets the other numbers in the eval the same way. Values are given all at
once. Any change clears the hash. Not case sensitive.

```
feature
feature def
feature <name>
feature <name> def
feature <name> <v1> ... <vn>
```

- `tempo <v>` - bonus for the side to move.
- `phase <n> <b> <r> <q>` - phase weights, the taper runs from their total at the start down to 0.
- `shelter <v0> <v1> <v2> <v3>` - king shelter penalty by the distance of the nearest own pawn ahead of the king.
- `mopup <centre> <close> <lead>` - mop up bonus in pawnless endings.
- `mat mg|eg <p> <n> <b> <r> <q>` - material for both colours, `wmat` or `bmat` for one.

### Examples

`feature` prints everything, one line each, again in the form the set command takes. `feature phase` prints just the
phase weights, `feature mat mg` the middlegame material lines for both colours.

`feature tempo 20` doubles the bonus for having the move, which makes the engine a little more inclined to keep
the initiative.

`feature phase 1 1 2 4` are the defaults. A knight or bishop counts 1, a rook 2 and a queen 4, so the start position
totals 24 and the eval is blended from the middlegame values at 24 to the endgame values at 0 as pieces come off.
`feature phase 2 2 4 8` keeps the same shape but the total is 48, so the same blend happens at the same points, the
numbers just scale. `feature phase 0 0 0 4` makes the taper depend on the queens alone.

`feature shelter 0 4 8 12` are the defaults. The four values are the penalty for the nearest own pawn being 0, 1, 2
or 3 ranks ahead of the king on each of the three files around it, none within three counting as 3, so with a pawn
right in front there is no penalty and an open file costs 12. The king's own file is doubled. It only applies in the
middlegame and only while the opponent has a queen. `feature shelter 0 8 16 24` makes the engine care twice as much
about pawn cover, `feature shelter 0 0 0 0` turns it off.

`feature mopup 10 8 200` are the defaults. In an ending with no pawns and a lead of at least 200 the winning side gets
10 per step the losing king is from the centre plus 8 per step the two kings are close, which drives the king to the
edge and the mating king towards it.

`feature mat mg 82 337 365 477 1025` are the default middlegame values for pawn, knight, bishop, rook and queen.
`feature mat eg 94 281 297 512 936` the endgame ones. `feature bmat mg 82 337 400 477 1025` makes black alone value
its bishops at 400.

`feature tempo def`, `feature mat mg def` and `feature def` reset one feature, one table of material or everything.

## Command line

Naddu can also be started from a command line using `Node` or `Bun`:-

```
node naddu.js
```

Or give it commands:-

```
bun naddu.js uci ucinewgame "position startpos" "go depth 8"
```

## Creating binaries

You can create executables using `Bun`:-

```
bun build naddu.js --compile --minify --target=bun-windows-x64   --outfile=naddu-win-x64
bun build naddu.js --compile --minify --target=bun-windows-arm64 --outfile=naddu-win-arm64
bun build naddu.js --compile --minify --target=bun-linux-x64     --outfile=naddu-linux-x64
bun build naddu.js --compile --minify --target=bun-linux-arm64   --outfile=naddu-linux-arm64
bun build naddu.js --compile --minify --target=bun-darwin-x64    --outfile=naddu-mac-x64
bun build naddu.js --compile --minify --target=bun-darwin-arm64  --outfile=naddu-mac-arm64
```

The Linux arm64 binary runs on a Raspberry Pi 3 or later with a 64-bit OS. Add `-musl` to
the Linux targets for Alpine. 

