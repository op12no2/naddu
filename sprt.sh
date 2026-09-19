#!/bin/bash

# SPRT, dev naddu.js v releases/naddu.js, 10+0.1, using fastchess.
# Run from anywhere, e.g. ./sprt.sh
# Override with env vars, e.g. ROUNDS=10 ./sprt.sh for a quick smoke test,
# ELO0=-5 ELO1=0 for a non regression test, GAMES=500 for a fixed length match with no sprt (a gauge),
# or BASE=/path/to/engine to play another uci engine, a binary or a .js engine which is compiled with bun
# like naddu, e.g. BASE=~/engines/lozza9.js

set -e

cd "$(dirname "$0")/.."

if pgrep -f "./fastchess -engine" > /dev/null; then
  echo "a match is already running"
  exit 1
fi

rounds=${ROUNDS:-10000}         # 2 games per round with -repeat, the sprt stops long before this
sprt="-sprt elo0=${ELO0:-0} elo1=${ELO1:-5} alpha=0.05 beta=0.1 model=normalized"
if [ -n "$GAMES" ]; then      # a fixed length match instead
  rounds=$((GAMES / 2))
  sprt=""
fi
concurrency=${CONCURRENCY:-16}
tc=${TC:-10+0.1}
timemargin=${TIMEMARGIN:-200}   # some engines overshoot the clock, raise this for a fair gauntlet
hash=${HASH:-16}                # MB for both engines, naddu's default, other engines often default higher
book=4moves_noob.epd
pgn=sprt.pgn

dev=/tmp/naddu-dev
base=/tmp/naddu-base

bun build naddu.js --compile --minify --outfile $dev > /dev/null

# BASE=/path/to/engine plays dev against another engine instead of the release, a .js one is compiled
if [ -n "$BASE" ]; then
  case "$BASE" in
    *.js) base=/tmp/naddu-base-$(basename "$BASE" .js)
          bun build "$BASE" --compile --minify --outfile $base > /dev/null ;;
    *)    base=$BASE ;;
  esac
else
  bun build releases/naddu.js --compile --minify --outfile $base > /dev/null
fi

printf 'uci\nquit\n' | $dev  > /dev/null
printf 'uci\nquit\n' | $base > /dev/null

rm -f $pgn

./fastchess \
  -engine name=dev  cmd=$dev \
  -engine name=base cmd=$base \
  -each proto=uci tc=$tc timemargin=$timemargin option.Hash=$hash \
  -rounds $rounds -repeat \
  $sprt \
  -concurrency $concurrency \
  -openings file=$book format=epd order=random \
  -srand $RANDOM$RANDOM \
  -draw movenumber=40 movecount=8 score=10 \
  -resign movecount=5 score=400 \
  -pgnout file=$pgn append=false \
  -ratinginterval 50 \
  "$@"
