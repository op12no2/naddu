#!/bin/bash

# 2000 game match, dev naddu.js v releases/naddu.js, 1+0.1, using fastchess.
# Run from anywhere, e.g. ./tooling/match.sh
# Override with env vars, e.g. ROUNDS=10 ./tooling/match.sh for a quick smoke test.

set -e

cd "$(dirname "$0")/.."

rounds=${ROUNDS:-1000}          # 2 games per round with -repeat
concurrency=${CONCURRENCY:-16}
tc=${TC:-1+0.1}
book=tooling/4moves_noob.epd
pgn=tooling/match.pgn

dev=/tmp/naddu-dev
base=/tmp/naddu-base

bun build naddu.js          --compile --minify --outfile $dev  > /dev/null
bun build releases/naddu.js --compile --minify --outfile $base > /dev/null

$dev  uci q > /dev/null
$base uci q > /dev/null

rm -f $pgn

tooling/fastchess \
  -engine name=dev  cmd=$dev \
  -engine name=base cmd=$base \
  -each proto=uci tc=$tc timemargin=200 \
  -rounds $rounds -repeat \
  -concurrency $concurrency \
  -openings file=$book format=epd order=random \
  -srand $RANDOM$RANDOM \
  -draw movenumber=40 movecount=8 score=10 \
  -resign movecount=5 score=400 \
  -pgnout file=$pgn append=false \
  -ratinginterval 100 \
  "$@"
