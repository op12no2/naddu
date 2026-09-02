#!/bin/bash

# 2000 game match, dev naddu.js v releases/naddu.js, 1+0.1, using fastchess.
# Run from anywhere, e.g. ./tooling/match.sh
# Override with env vars, e.g. ROUNDS=10 ./tooling/match.sh for a quick smoke test,
# or BASE=/path/to/engine ./tooling/match.sh to play against another uci engine.

set -e

cd "$(dirname "$0")/.."

if pgrep -f "tooling/fastchess -engine" > /dev/null; then
  echo "a match is already running"
  exit 1
fi

rounds=${ROUNDS:-1000}          # 2 games per round with -repeat
concurrency=${CONCURRENCY:-16}
tc=${TC:-1+0.1}
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
  -concurrency $concurrency \
  -openings file=$book format=epd order=random \
  -srand $RANDOM$RANDOM \
  -draw movenumber=40 movecount=8 score=10 \
  -resign movecount=5 score=400 \
  -pgnout file=$pgn append=false \
  -ratinginterval 100 \
  "$@"
