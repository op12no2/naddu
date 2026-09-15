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
without editing it. Pieces are `p n b r q k`, which means both colours with black mirrored, or `wn`, `bq` etc for one
colour. Squares are absolute, `e4` is e4 for either colour. Values are whole centipawns separated by spaces, any
whitespace will do, in the order a1 b1 ... h1 a2 ... h8, i.e. rank by rank from white's side. mg is middlegame and eg
endgame. Not case sensitive. Any change clears the hash.

- `pst` - print all 24 tables, one line each, e.g. `pst wn mg <64 values>`.
- `pst n` or `pst wn mg` - print some of them.
- `pst n mg e4` - print one square, `pst n e4` prints white mg, white eg, black mg, black eg, black being e5.
- `pst n mg e4 25` - set one square, white e4 and black e5.
- `pst bn mg e4 25` - set one square for black only.
- `pst n mg -105 -21 -58 ... -107` - set a table from 64 values, a printed line can be pasted back.
- `pst n mg def`, `pst n def`, `pst def` - reset a table, a piece or everything to the PeSTO values.

## Features

The `feature` command prints, sets and resets the other numbers in the eval the same way. Values are whole numbers
separated by spaces and given all at once, a printed line can be pasted back, and any change clears the hash. `feature` prints everything, `feature def`
resets everything.

- `feature tempo 10` - bonus for the side to move.
- `feature phase 1 1 2 4` - phase weights for knight, bishop, rook and queen, the taper runs from their total at the
  start, 24 by default, down to 0.
- `feature shelter 0 4 8 12` - king shelter penalty by how far the nearest pawn is ahead of the king on each of the
  three files around it, doubled on the king's file, middlegame only and only while the opponent has a queen.
- `feature mopup 10 8 200` - in pawnless endings, per step the losing king is from the centre, per step the kings are
  close, and the endgame lead needed to switch it on.
- `feature mat mg 82 337 365 477 1025` - material from pawn to queen, `mg` or `eg`, for both colours, or `wmat` and
  `bmat` for one colour.
- `feature tempo def`, `feature mat mg def` - back to the defaults.

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

