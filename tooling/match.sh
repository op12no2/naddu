#!/bin/bash

# SPRT, dev naddu.js v releases/naddu.js, 10+0.1, using fastchess.
# Run from anywhere, e.g. ./tooling/match.sh
# Override with env vars, e.g. ROUNDS=10 ./tooling/match.sh for a quick smoke test,
# ELO0=-5 ELO1=0 for a non regression test, or BASE=/path/to/engine to play another uci engine.

set -e

cd "$(dirname "$0")/.."

if pgrep -f "tooling/fastchess -engine" > /dev/null; then
  echo "a match is already running"
  exit 1
fi

rounds=${ROUNDS:-10000}         # 2 games per round with -repeat, the sprt stops long before this
elo0=${ELO0:-0}
elo1=${ELO1:-5}
concurrency=${CONCURRENCY:-16}
tc=${TC:-10+0.1}
timemargin=${TIMEMARGIN:-200}   # some engines overshoot the clock, raise this for a fair gauntlet
book=tooling/4moves_noob.epd
pgn=tooling/match.pgn

dev=/tmp/naddu-dev
base=/tmp/naddu-base

bun build naddu.js --compile --minify --outfile $dev > /dev/null

# BASE=/path/to/engine plays dev against any uci binary instead of the release
if [ -n "$BASE" ]; then
  base=$BASE
else
  bun build releases/naddu.js --compile --minify --outfile $base > /dev/null
fi

$dev  uci q > /dev/null
$base uci q > /dev/null

rm -f $pgn

tooling/fastchess \
  -engine name=dev  cmd=$dev \
  -engine name=base cmd=$base \
  -each proto=uci tc=$tc timemargin=$timemargin \
  -rounds $rounds -repeat \
  -sprt elo0=$elo0 elo1=$elo1 alpha=0.05 beta=0.1 model=normalized \
  -concurrency $concurrency \
  -openings file=$book format=epd order=random \
  -srand $RANDOM$RANDOM \
  -draw movenumber=40 movecount=8 score=10 \
  -resign movecount=5 score=400 \
  -pgnout file=$pgn append=false \
  -ratinginterval 100 \
  "$@"
