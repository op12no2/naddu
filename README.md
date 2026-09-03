# Naddu

Naddu is a Javascript UCI chess engine.

It can be easily included in your web pages.

All you need is `naddu.js` from the repo root.

The code is written in a straight-forward manner and deliberately easy to tweak.

Strength is around 2300 Elo.

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
- [parallel](https://op12no2.github.io/naddu/examples/parallel.html) - workers share out the root moves of one position and search them together.

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
bun build naddu.js --compile --minify --target=bun-windows-x64  --outfile=naddu-win-x64
bun build naddu.js --compile --minify --target=bun-linux-x64    --outfile=naddu-linux-x64
bun build naddu.js --compile --minify --target=bun-darwin-x64   --outfile=naddu-mac-x64
bun build naddu.js --compile --minify --target=bun-darwin-arm64 --outfile=naddu-mac-arm64
```

