//
// https://github.com/op12no2/naddu
//
// data structures
//
// WHITE, BLACK: 0, 8
// PAWN to KING: 1 to 6
// board: 0x88 
// moves: `(from square << 8) | to square | flags`
// TT uses 2 x Uint32 typed arrays
//
// useful expressions
//
// get piece type: piece & 0x7
// get piece color: piece & BLACK
// toggle color: color ^ BLACK
// get 0,1 index from color: color >> 3
// toggle colour index: colorIndex ^ 1
// get to square from move: move & 0xff
// get from square from move: (move >> 8) & 0xff
// encode move: (from << 8) | to | flags
// i often assume WHITE is 0, i.e. if (color) ...
//

function now() {
  return performance.now() | 0;
}

const WHITE = 0;
const BLACK = 8;

const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;

const PIECE_MAP = {
  'P': PAWN, 'N': KNIGHT, 'B': BISHOP, 'R': ROOK, 'Q': QUEEN, 'K': KING,
  'p': PAWN|BLACK, 'n': KNIGHT|BLACK, 'b': BISHOP|BLACK, 'r': ROOK|BLACK, 'q': QUEEN|BLACK, 'k': KING|BLACK
};

const RIGHTS_K = 1;
const RIGHTS_Q = 2;
const RIGHTS_k = 4;
const RIGHTS_q = 8;

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

//
// the board is 0x88 https://www.chessprogramming.org/0x88
//

class Pos {

  constructor() {
    this.board = new Uint8Array(128);
    this.kings = new Uint8Array(2);
    this.ep = 0;
    this.rights = 0;
    this.stm = 0;
    this.hashLo = 0;
    this.hashHi = 0;
    this.hmc = 0;  // halfmove clock for 50-move rule and repetition detection
  }
}

function posClear(pos) {
  pos.board.fill(0);
  pos.kings.fill(0);
  pos.ep = 0;
  pos.rights = 0;
  pos.stm = 0;
  pos.hashLo = 0;
  pos.hashHi = 0;
  pos.hmc = 0;
}

function posSet(pos, other) {
  pos.board.set(other.board);
  pos.kings.set(other.kings);
  pos.ep = other.ep;
  pos.rights = other.rights;
  pos.stm = other.stm;
  pos.hashLo = other.hashLo;
  pos.hashHi = other.hashHi;
  pos.hmc = other.hmc;
}

let positionSet = 0; // so go can init to startpos if the user forgets

function position(fen, moves) {

  const node = nodes[0];
  const pos = node.pos;

  positionSet = 1;

  posClear(pos);

  const parts = fen.split(' ');
  const ranks = parts[0].split('/');

  for (let rank = 7; rank >= 0; rank--) {
    const fenRank = ranks[7 - rank];
    let file = 0;
    for (let i = 0; i < fenRank.length; i++) {
      const c = fenRank[i];
      if (c >= '1' && c <= '8') {
        file += parseInt(c);
      }
      else {
        const sq = rank * 16 + file;
        const piece = PIECE_MAP[c];
        pos.board[sq] = piece;
        if (c === 'K') pos.kings[WHITE >> 3] = sq;
        if (c === 'k') pos.kings[BLACK >> 3] = sq;
        file++;
      }
    }
  }

  pos.stm = (parts[1] === 'w') ? WHITE : BLACK;

  const castling = parts[2] || '-';
  if (castling.includes('K')) pos.rights |= RIGHTS_K;
  if (castling.includes('Q')) pos.rights |= RIGHTS_Q;
  if (castling.includes('k')) pos.rights |= RIGHTS_k;
  if (castling.includes('q')) pos.rights |= RIGHTS_q;

  const epStr = parts[3] || '-';
  if (epStr !== '-') {
    const epFile = epStr.charCodeAt(0) - 97;
    const epRank = parseInt(epStr[1]) - 1;
    pos.ep = epRank * 16 + epFile;
  }

  pos.hmc = parseInt(parts[4]) || 0;

  zobRebuild(pos);
  repClear();
  repPush(pos);

  // Apply moves if provided
  if (moves && moves.length > 0) {
    for (let i = 0; i < moves.length; i++) {
      doMove(moves[i]);
      repPush(pos);
    }
  }

  historyClear();
  killersClear();

}

function printBoard() {

  const node = nodes[0];
  const pos = node.pos;

  const pieces = '.PNBRQK..pnbrqk';
  const files = 'abcdefgh';

  uciWrite('');
  for (let rank = 7; rank >= 0; rank--) {
    let line = (rank + 1) + '  ';
    for (let file = 0; file < 8; file++) {
      const sq = rank * 16 + file;
      const piece = pos.board[sq];
      line += pieces[piece] + ' ';
    }
    uciWrite(line);
  }
  uciWrite('');
  uciWrite('   a b c d e f g h');
  uciWrite('');

  const wKingSq = pos.kings[WHITE >> 3];
  const bKingSq = pos.kings[BLACK >> 3];
  const wKingCoord = files[wKingSq & 7] + ((wKingSq >> 4) + 1);
  const bKingCoord = files[bKingSq & 7] + ((bKingSq >> 4) + 1);

  let rightsStr = '';
  if (pos.rights & RIGHTS_K) rightsStr += 'K';
  if (pos.rights & RIGHTS_Q) rightsStr += 'Q';
  if (pos.rights & RIGHTS_k) rightsStr += 'k';
  if (pos.rights & RIGHTS_q) rightsStr += 'q';
  if (rightsStr === '') rightsStr = '-';

  uciWrite('kings: white=' + wKingCoord + ' black=' + bKingCoord);
  uciWrite('rights: ' + rightsStr);
  uciWrite('stm: ' + (pos.stm === WHITE ? 'white' : 'black'));
  uciWrite('');
}

const MAX_PLY = 64;
const MAX_MOVES = 256;

class Node {

  constructor() {
    this.pos = null;
    this.moves = new Uint32Array(MAX_MOVES);
    this.ranks = new Int32Array(MAX_MOVES);
    this.numMoves = 0;
    this.nextMove = 0;
    this.stage = 0;
    this.ttMove = 0;
    this.killer = 0;
    this.draw = 0;
    this.noNull = 0; // set on the child of a null move
    this.pv = new Uint32Array(MAX_PLY); // triangular pv, copied up from child on alpha improvement
    this.pvLen = 0;
  }
}

const nodes = Array(MAX_PLY);

function nodeInitOnce() {
  for (let i=0; i < MAX_PLY; i++ ) {
    nodes[i] = new Node();
    nodes[i].pos = new Pos();
  }
}

//
// xorshift32 generator for the zobrist keys https://www.chessprogramming.org/Pseudorandom_Number_Generator
//

let rand32Seed = 1234567890;

function rand32() {
  rand32Seed ^= rand32Seed << 13;
  rand32Seed ^= rand32Seed >>> 17;
  rand32Seed ^= rand32Seed << 5;
  return rand32Seed >>> 0;
}

//
// zobrist hashing, 2 x 32 bit keys https://www.chessprogramming.org/Zobrist_Hashing
//

const zobBlackLo = rand32();
const zobBlackHi = rand32();

const zobRightsLo = new Uint32Array(16);
const zobRightsHi = new Uint32Array(16);
const zobEpLo = new Uint32Array(128);
const zobEpHi = new Uint32Array(128);
const zobPiecesLo = new Array(16);
const zobPiecesHi = new Array(16);

function zobInitOnce() {

  for (let i = 0; i < 16; i++) {
    zobRightsLo[i] = rand32();
    zobRightsHi[i] = rand32();
  }

  for (let i = 0; i < 128; i++) {
    zobEpLo[i] = rand32();
    zobEpHi[i] = rand32();
  }

  for (let i = 0; i < 16; i++) {
    zobPiecesLo[i] = new Uint32Array(128);
    zobPiecesHi[i] = new Uint32Array(128);
    for (let j = 0; j < 128; j++) {
      zobPiecesLo[i][j] = rand32();
      zobPiecesHi[i][j] = rand32();
    }
  }

}

function zobRebuild(pos) {

  let lo = 0;
  let hi = 0;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      let sq = rank * 16 + file;
      let piece = pos.board[sq];
      if (piece) {
        lo ^= zobPiecesLo[piece][sq];
        hi ^= zobPiecesHi[piece][sq];
      }
    }
  }

  if (pos.stm === BLACK) {
    lo ^= zobBlackLo;
    hi ^= zobBlackHi;
  }

  lo ^= zobRightsLo[pos.rights];
  hi ^= zobRightsHi[pos.rights];

  if (pos.ep) {
    lo ^= zobEpLo[pos.ep];
    hi ^= zobEpHi[pos.ep];
  }

  pos.hashLo = lo >>> 0;
  pos.hashHi = hi >>> 0;

}

// Repetition detection using flat history array https://www.chessprogramming.org/Repetitions
// Stores [hashLo, hashHi] pairs for each position

const REP_MAX = 1024;
const repHistory = new Uint32Array(REP_MAX * 2);
let repGamePly = 0;  // end of game history (locked after UCI position command)

function repClear() {
  repGamePly = 0;
}

function repPush(pos) {
  const idx = repGamePly * 2;
  repHistory[idx] = pos.hashLo;
  repHistory[idx + 1] = pos.hashHi;
  repGamePly++;
}

function isRepetition(pos, ply) {
  const hashLo = pos.hashLo;
  const hashHi = pos.hashHi;
  const currentPly = repGamePly + ply;

  // Only need to look back as far as the halfmove clock allows
  // (positions before last pawn move/capture can't repeat)
  const lookback = Math.min(currentPly, pos.hmc);

  // Step back by 2 (same side to move)
  // Start at currentPly - 2 (the position 2 plies ago)
  for (let i = 2; i <= lookback; i += 2) {
    const idx = (currentPly - i) * 2;
    if (repHistory[idx] === hashLo && repHistory[idx + 1] === hashHi) {
      // Found once in game history = can force 3-fold (2-fold rule)
      // Found once in search = 2-fold in search tree
      return true;
    }
  }
  return false;
}

// https://www.chessprogramming.org/Fifty-move_Rule
function isFiftyMoves(pos) {
  return pos.hmc >= 100;
}

function isDraw(pos, ply) {
  return isFiftyMoves(pos) || isRepetition(pos, ply);
}

// Record position at current search ply (called at start of search node)
function repRecord(pos, ply) {
  const idx = (repGamePly + ply) * 2;
  repHistory[idx] = pos.hashLo;
  repHistory[idx + 1] = pos.hashHi;
}

//
// transposition table, always replace https://www.chessprogramming.org/Transposition_Table
//

const TT_EXACT = 1;
const TT_ALPHA = 2;
const TT_BETA = 3;
const TT_MATE_BOUND = 9900;
// 16 bytes per entry, size is set by the uci Hash option (MB) and rounded down to a power of 2
const TT_DEFAULT_MB = 16;
const TT_MIN_MB = 1;
const TT_MAX_MB = 1024;

let TT_MASK = 0;

let ttHashLo = null;
let ttHashHi = null;
let ttMove = null;
let ttType = null;
let ttScore = null;
let ttDepth = null;

const ttStats = {hits: 0};

function ttInit(mb) {
  mb = Math.min(Math.max(mb | 0, TT_MIN_MB), TT_MAX_MB);
  let size = 1;
  while (size * 2 * 16 <= mb * 1024 * 1024)
    size *= 2;
  TT_MASK = size - 1;
  ttHashLo = new Uint32Array(size);
  ttHashHi = new Uint32Array(size);
  ttMove = new Uint32Array(size);
  ttType = new Uint8Array(size);
  ttScore = new Int16Array(size);
  ttDepth = new Uint8Array(size);
}

function ttClear() {
  ttType.fill(0);
}

function ttPut(pos, type, depth, score, move) {

  const index = pos.hashLo & TT_MASK;

  ttHashLo[index] = pos.hashLo;
  ttHashHi[index] = pos.hashHi;
  ttMove[index] = move;
  ttType[index] = type;
  ttScore[index] = score;
  ttDepth[index] = depth;

}

function ttGet(pos) {

  const hashLo = pos.hashLo;
  const hashHi = pos.hashHi;
  const index = hashLo & TT_MASK;

  if (ttHashLo[index] === hashLo && ttHashHi[index] === hashHi && ttType[index]) {
    return index;
  }

  return -1;
}

function ttGetMove(index) {
  return ttMove[index];
}

function ttGetType(index) {
  return ttType[index];
}

function ttGetScore(index) {
  return ttScore[index];
}

function ttGetDepth(index) {
  return ttDepth[index];
}

function ttScoreToTT(score, ply) {
  if (score > TT_MATE_BOUND)
    return score + ply;
  if (score < -TT_MATE_BOUND)
    return score - ply;
  return score;
}

function ttScoreFromTT(score, ply) {
  if (score > TT_MATE_BOUND)
    return score - ply;
  if (score < -TT_MATE_BOUND)
    return score + ply;
  return score;
}

//
// piece-to history heuristic for ordering quiet moves https://www.chessprogramming.org/History_Heuristic
//

const pieceHistory = [];
const HISTORY_MAX = 32767 - MAX_PLY * MAX_PLY;

function historyInitOnce() {
  for (let i = 0; i < 16; i++) {
    pieceHistory[i] = new Int16Array(128);
  }
}

function historyClear() {
  for (let i = 0; i < 16; i++) {
    pieceHistory[i].fill(0);
  }
}

function historyHalve() {
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 128; j++) {
      pieceHistory[i][j] = pieceHistory[i][j] >> 1;
    }
  }
}

function addHistory(pos, move, depth) {
  if (move & MOVE_FLAG_CAPTURE)
    return;
  const from = (move >> 8) & 0xff;
  const to = move & 0xff;
  const piece = pos.board[from];
  const bonus = depth * depth;
  const current = pieceHistory[piece][to];
  const update = bonus - ((current * bonus) / HISTORY_MAX) | 0;
  const newVal = current + update;
  if (newVal >= HISTORY_MAX) {
    historyHalve();
    pieceHistory[piece][to] += (update / 2) | 0;
  }
  else {
    pieceHistory[piece][to] = newVal;
  }
}

//
// one killer move per ply https://www.chessprogramming.org/Killer_Heuristic
//

function killersClear() {
  for (let i = 0; i < MAX_PLY; i++) {
    nodes[i].killer = 0;
  }
}

function killerSet(node, move) {
  if (move & MOVE_FLAG_CAPTURE)
    return;
  node.killer = move;
}

// https://www.chessprogramming.org/Square_Attacked_By
function isAttacked(pos, sq, byColor) {
  const board = pos.board;

  // pawns
  const pawnDir = byColor === WHITE ? -16 : 16;
  const pawn = PAWN | byColor;
  const p1 = sq + pawnDir - 1;
  if (p1 >= 0 && !(p1 & 0x88) && board[p1] === pawn) return 1;
  const p2 = sq + pawnDir + 1;
  if (p2 >= 0 && !(p2 & 0x88) && board[p2] === pawn) return 1;

  // knights
  const knight = KNIGHT | byColor;
  for (let i = 0; i < 8; i++) {
    const to = sq + KNIGHT_OFFSETS[i];
    if (!(to & 0x88) && board[to] === knight) return 1;
  }

  // king
  const king = KING | byColor;
  for (let i = 0; i < 8; i++) {
    const to = sq + KING_OFFSETS[i];
    if (!(to & 0x88) && board[to] === king) return 1;
  }

  // bishops/queens (diagonals)
  const bishop = BISHOP | byColor;
  const queen = QUEEN | byColor;
  for (let i = 0; i < 4; i++) {
    const off = BISHOP_OFFSETS[i];
    let to = sq + off;
    while (to >= 0 && !(to & 0x88)) {
      const piece = board[to];
      if (piece) {
        if (piece === bishop || piece === queen) return 1;
        break;
      }
      to += off;
    }
  }

  // rooks/queens (straights)
  const rook = ROOK | byColor;
  for (let i = 0; i < 4; i++) {
    const off = ROOK_OFFSETS[i];
    let to = sq + off;
    while (to >= 0 && !(to & 0x88)) {
      const piece = board[to];
      if (piece) {
        if (piece === rook || piece === queen) return 1;
        break;
      }
      to += off;
    }
  }

  return 0;
}

//
// pseudo-legal move generation, legality is checked after makeMove https://www.chessprogramming.org/Pseudo-Legal_Move
//

function genMoves(node) {
  node.numMoves = 0;
  genCaptures(node);
  genQuiets(node);
}

//
// move encoding: (from << 8) | to | flags https://www.chessprogramming.org/Encoding_Moves
//

const MOVE_FLAG_CAPTURE    = 0x10000;
const MOVE_FLAG_EPMAKE     = 0x20000;
const MOVE_FLAG_EPCAPTURE  = 0x40000;
const MOVE_FLAG_KCASTLE    = 0x80000;
const MOVE_FLAG_QCASTLE    = 0x100000;
const MOVE_FLAG_KING       = 0x200000;

const MOVE_PROMO_SHIFT = 22;
const MOVE_PROMO_MASK  = 0x7 << MOVE_PROMO_SHIFT;
const MOVE_PROMO_Q     = 5 << MOVE_PROMO_SHIFT;
const MOVE_PROMO_R     = 4 << MOVE_PROMO_SHIFT;
const MOVE_PROMO_B     = 3 << MOVE_PROMO_SHIFT;
const MOVE_PROMO_N     = 2 << MOVE_PROMO_SHIFT;

const MOVE_EXTRA_MASK = MOVE_FLAG_QCASTLE | MOVE_FLAG_KCASTLE | MOVE_FLAG_EPCAPTURE | MOVE_FLAG_EPMAKE | MOVE_FLAG_KING | MOVE_PROMO_MASK;

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_OFFSETS = [-17, -15, 15, 17];
const ROOK_OFFSETS   = [-16, -1, 1, 16];
const QUEEN_OFFSETS  = [-17, -16, -15, -1, 1, 15, 16, 17];
const KING_OFFSETS   = [-17, -16, -15, -1, 1, 15, 16, 17];
const PAWN_CAP_WHITE = [15, 17];
const PAWN_CAP_BLACK = [-15, -17];

function genCaptures(node) {

  const moves = node.moves;
  const pos = node.pos;
  const board = pos.board;
  const stm = pos.stm;
  const nstm = stm ^ BLACK;

  let numMoves = node.numMoves;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;

    const piece = board[sq];
    if (!piece) continue;
    if ((piece & BLACK) !== stm) continue;

    const type = piece & 7;

    switch (type) {
      case PAWN: {
        const promoRank = stm === WHITE ? 6 : 1;
        const rank = sq >> 4;
        const isPromo = rank === promoRank;
        const capOffsets = stm === WHITE ? PAWN_CAP_WHITE : PAWN_CAP_BLACK;
        for (const off of capOffsets) {
          const to = sq + off;
          if (to & 0x88) continue;
          const target = board[to];
          if (target && (target & BLACK) === nstm) {
            if (isPromo) {
              moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE | MOVE_PROMO_Q;
              moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE | MOVE_PROMO_R;
              moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE | MOVE_PROMO_B;
              moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE | MOVE_PROMO_N;
            }
            else {
              moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE;
            }
          }
          else if (pos.ep && to === pos.ep) {
            moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_EPCAPTURE | MOVE_FLAG_CAPTURE;
          }
        }
        break;
      }

      case KNIGHT: {
        for (const off of KNIGHT_OFFSETS) {
          const to = sq + off;
          if (to & 0x88) continue;
          const target = board[to];
          if (target && (target & BLACK) === nstm) {
            moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE;
          }
        }
        break;
      }

      case BISHOP: {
        for (const off of BISHOP_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            const target = board[to];
            if (target) {
              if ((target & BLACK) === nstm) {
                moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE;
              }
              break;
            }
            to += off;
          }
        }
        break;
      }

      case ROOK: {
        for (const off of ROOK_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            const target = board[to];
            if (target) {
              if ((target & BLACK) === nstm) {
                moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE;
              }
              break;
            }
            to += off;
          }
        }
        break;
      }

      case QUEEN: {
        for (const off of QUEEN_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            const target = board[to];
            if (target) {
              if ((target & BLACK) === nstm) {
                moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE;
              }
              break;
            }
            to += off;
          }
        }
        break;
      }

      case KING: {
        for (const off of KING_OFFSETS) {
          const to = sq + off;
          if (to & 0x88) continue;
          const target = board[to];
          if (target && (target & BLACK) === nstm && (target & 7) !== KING) {
            moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_CAPTURE | MOVE_FLAG_KING;
          }
        }
        break;
      }
    }
  }

  node.numMoves = numMoves;
}

function genQuiets(node) {

  const moves = node.moves;
  const pos = node.pos;
  const board = pos.board;
  const stm = pos.stm;

  let numMoves = node.numMoves;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;

    const piece = board[sq];
    if (!piece) continue;
    if ((piece & BLACK) !== stm) continue;

    const type = piece & 7;

    switch (type) {
      case PAWN: {
        const dir = stm === WHITE ? 16 : -16;
        const promoRank = stm === WHITE ? 6 : 1;
        const startRank = stm === WHITE ? 1 : 6;
        const rank = sq >> 4;
        const isPromo = rank === promoRank;
        const to1 = sq + dir;
        if (!(to1 & 0x88) && !board[to1]) {
          if (isPromo) {
            moves[numMoves++] = to1 | (sq << 8) | MOVE_PROMO_Q;
            moves[numMoves++] = to1 | (sq << 8) | MOVE_PROMO_R;
            moves[numMoves++] = to1 | (sq << 8) | MOVE_PROMO_B;
            moves[numMoves++] = to1 | (sq << 8) | MOVE_PROMO_N;
          }
          else {
            moves[numMoves++] = to1 | (sq << 8);
            if (rank === startRank) {
              const to2 = sq + dir + dir;
              if (!(to2 & 0x88) && !board[to2]) {
                moves[numMoves++] = to2 | (sq << 8) | MOVE_FLAG_EPMAKE;
              }
            }
          }
        }
        break;
      }

      case KNIGHT: {
        for (const off of KNIGHT_OFFSETS) {
          const to = sq + off;
          if (to & 0x88) continue;
          if (!board[to]) {
            moves[numMoves++] = to | (sq << 8);
          }
        }
        break;
      }

      case BISHOP: {
        for (const off of BISHOP_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            if (board[to]) break;
            moves[numMoves++] = to | (sq << 8);
            to += off;
          }
        }
        break;
      }

      case ROOK: {
        for (const off of ROOK_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            if (board[to]) break;
            moves[numMoves++] = to | (sq << 8);
            to += off;
          }
        }
        break;
      }

      case QUEEN: {
        for (const off of QUEEN_OFFSETS) {
          let to = sq + off;
          while (!(to & 0x88)) {
            if (board[to]) break;
            moves[numMoves++] = to | (sq << 8);
            to += off;
          }
        }
        break;
      }

      case KING: {
        for (const off of KING_OFFSETS) {
          const to = sq + off;
          if (to & 0x88) continue;
          if (!board[to]) {
            moves[numMoves++] = to | (sq << 8) | MOVE_FLAG_KING;
          }
        }
        break;
      }
    }
  }

  if (pos.rights) {
    if (stm === WHITE) {
      if ((pos.rights & RIGHTS_K) && !board[0x05] && !board[0x06] &&
          !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x05, BLACK) && !isAttacked(pos, 0x06, BLACK)) {
        moves[numMoves++] = 0x06 | (0x04 << 8) | MOVE_FLAG_KCASTLE;
      }
      if ((pos.rights & RIGHTS_Q) && !board[0x03] && !board[0x02] && !board[0x01] &&
          !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x03, BLACK) && !isAttacked(pos, 0x02, BLACK)) {
        moves[numMoves++] = 0x02 | (0x04 << 8) | MOVE_FLAG_QCASTLE;
      }
    }
    else {
      if ((pos.rights & RIGHTS_k) && !board[0x75] && !board[0x76] &&
          !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x75, WHITE) && !isAttacked(pos, 0x76, WHITE)) {
        moves[numMoves++] = 0x76 | (0x74 << 8) | MOVE_FLAG_KCASTLE;
      }
      if ((pos.rights & RIGHTS_q) && !board[0x73] && !board[0x72] && !board[0x71] &&
          !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x73, WHITE) && !isAttacked(pos, 0x72, WHITE)) {
        moves[numMoves++] = 0x72 | (0x74 << 8) | MOVE_FLAG_QCASTLE;
      }
    }
  }

  node.numMoves = numMoves;
}

//
// staged move ordering: tt move, captures by MVV-LVA, killer then history for quiets, picked by selection sort
// https://www.chessprogramming.org/Move_Ordering
//

const STAGE_TT          = 0;
const STAGE_GEN_CAPTURE = 1;
const STAGE_CAPTURE     = 2;
const STAGE_GEN_QUIET   = 3;
const STAGE_QUIET       = 4;
const STAGE_DONE        = 5;

// https://www.chessprogramming.org/MVV-LVA
function rankCaptures(node) {
  const pos = node.pos;
  const board = pos.board;
  const moves = node.moves;
  const ranks = node.ranks;
  for (let i = 0; i < node.numMoves; i++) {
    const move = moves[i];
    const to = move & 0xff;
    const victim = (move & MOVE_FLAG_EPCAPTURE) ? PAWN : board[to] & 7;
    const attacker = board[(move >> 8) & 0xff] & 7;
    ranks[i] = victim * 16 - attacker;
  }
}

function rankQuiets(node) {
  const pos = node.pos;
  const board = pos.board;
  const moves = node.moves;
  const ranks = node.ranks;
  for (let i = 0; i < node.numMoves; i++) {
    const move = moves[i];
    if (move === node.killer) {
      ranks[i] = HISTORY_MAX + 1;
    }
    else {
      const from = (move >> 8) & 0xff;
      const to = move & 0xff;
      const piece = board[from];
      ranks[i] = pieceHistory[piece][to];
    }
  }
}

function initNextMove(node, ttMove) {
  node.ttMove = ttMove;
  node.stage = ttMove ? STAGE_TT : STAGE_GEN_CAPTURE;
  node.numMoves = 0;
  node.nextMove = 0;
}

function initNextMoveQS(node, ttMove) {
  node.ttMove = ttMove;
  node.stage = ttMove ? STAGE_TT : STAGE_GEN_CAPTURE;
  node.numMoves = 0;
  node.nextMove = 0;
}

function pickBest(node) {
  const moves = node.moves;
  const ranks = node.ranks;
  let bestIdx = node.nextMove;
  let bestRank = ranks[bestIdx];
  for (let i = node.nextMove + 1; i < node.numMoves; i++) {
    if (ranks[i] > bestRank) {
      bestRank = ranks[i];
      bestIdx = i;
    }
  }
  const idx = node.nextMove;
  if (bestIdx !== idx) {
    const tmpMove = moves[idx];
    const tmpRank = ranks[idx];
    moves[idx] = moves[bestIdx];
    ranks[idx] = ranks[bestIdx];
    moves[bestIdx] = tmpMove;
    ranks[bestIdx] = tmpRank;
  }
  node.nextMove++;
  return moves[idx];
}

function getNextMove(node) {
  const ttMove = node.ttMove;
  while (true) {
    switch (node.stage) {
      case STAGE_TT:
        node.stage = STAGE_GEN_CAPTURE;
        return ttMove;

      case STAGE_GEN_CAPTURE:
        node.numMoves = 0;
        genCaptures(node);
        rankCaptures(node);
        node.nextMove = 0;
        node.stage = STAGE_CAPTURE;
        continue;

      case STAGE_CAPTURE:
        if (node.nextMove >= node.numMoves) {
          node.stage = STAGE_GEN_QUIET;
          continue;
        }
        {
          const move = pickBest(node);
          if (move === ttMove)
            continue;
          return move;
        }

      case STAGE_GEN_QUIET:
        node.numMoves = 0;
        genQuiets(node);
        rankQuiets(node);
        node.nextMove = 0;
        node.stage = STAGE_QUIET;
        continue;

      case STAGE_QUIET:
        if (node.nextMove >= node.numMoves) {
          node.stage = STAGE_DONE;
          return 0;
        }
        {
          const move = pickBest(node);
          if (move === ttMove)
            continue;
          return move;
        }

      case STAGE_DONE:
        return 0;
    }
  }
}

function getNextMoveQS(node) {
  const ttMove = node.ttMove;
  while (true) {
    switch (node.stage) {
      case STAGE_TT:
        node.stage = STAGE_GEN_CAPTURE;
        return ttMove;

      case STAGE_GEN_CAPTURE:
        node.numMoves = 0;
        genCaptures(node);
        rankCaptures(node);
        node.nextMove = 0;
        node.stage = STAGE_CAPTURE;
        continue;

      case STAGE_CAPTURE:
        if (node.nextMove >= node.numMoves) {
          node.stage = STAGE_DONE;
          return 0;
        }
        {
          const move = pickBest(node);
          if (move === ttMove)
            continue;
          return move;
        }

      case STAGE_DONE:
        return 0;
    }
  }
}

function moveIsProbablyLegal(node, move) {

  if (move === 0)
    return 0;

  const pos = node.pos;
  const board = pos.board;
  const stm = pos.stm;

  const from = (move >> 8) & 0xff;
  const to = move & 0xff;

  // from and to must be on board
  if ((from | to) & 0x88)
    return 0;

  // must have our piece on from square
  const piece = board[from];
  if (!piece)
    return 0;
  if ((piece & BLACK) !== stm)
    return 0;

  // to square must be empty or enemy piece
  const target = board[to];
  if (target && (target & BLACK) === stm)
    return 0;

  return move;
}

function formatMove(move) {

  const from = (move >> 8) & 0xff;
  const to = move & 0xff;

  const fromFile = String.fromCharCode(97 + (from & 7));
  const fromRank = String.fromCharCode(49 + (from >> 4));
  const toFile = String.fromCharCode(97 + (to & 7));
  const toRank = String.fromCharCode(49 + (to >> 4));

  let moveStr = fromFile + fromRank + toFile + toRank;

  // Add promotion piece if applicable
  if (move & MOVE_PROMO_MASK) {
    const promoType = (move & MOVE_PROMO_MASK) >> MOVE_PROMO_SHIFT;
    const promoChars = ['', '', 'n', 'b', 'r', 'q'];
    moveStr += promoChars[promoType];
  }

  return moveStr;
}

const RIGHTS_MASK = new Uint8Array(128);
RIGHTS_MASK.fill(0xF);
RIGHTS_MASK[0x00] = 0xF ^ RIGHTS_Q;
RIGHTS_MASK[0x07] = 0xF ^ RIGHTS_K;
RIGHTS_MASK[0x70] = 0xF ^ RIGHTS_q;
RIGHTS_MASK[0x77] = 0xF ^ RIGHTS_k;
RIGHTS_MASK[0x04] = 0xF ^ RIGHTS_K ^ RIGHTS_Q;
RIGHTS_MASK[0x74] = 0xF ^ RIGHTS_k ^ RIGHTS_q;

//
// make move with incremental zobrist update, no unmake - positions are copied https://www.chessprogramming.org/Incremental_Updates
//

function makeMove(move, pos) {

  const from = (move >> 8) & 0xff;
  const to = move & 0xff;
  const piece = pos.board[from];
  const captured = pos.board[to];
  const oldRights = pos.rights;
  const oldEp = pos.ep;

  // Update halfmove clock: reset on pawn move or capture, else increment
  if ((piece & 0x7) === PAWN || captured || (move & MOVE_FLAG_EPCAPTURE)) {
    pos.hmc = 0;
  }
  else {
    pos.hmc++;
  }

  const pieceZobLo = zobPiecesLo[piece];
  const pieceZobHi = zobPiecesHi[piece];

  let lo = pos.hashLo;
  let hi = pos.hashHi;

  // remove piece from 'from' square
  lo ^= pieceZobLo[from];
  hi ^= pieceZobHi[from];

  // remove captured piece (if any)
  if (captured) {
    lo ^= zobPiecesLo[captured][to];
    hi ^= zobPiecesHi[captured][to];
  }

  pos.board[to] = piece;
  pos.board[from] = 0;
  pos.ep = 0;

  if (move & MOVE_EXTRA_MASK) {
    if (move & MOVE_PROMO_MASK) {
      const promoPiece = pos.stm | (move & MOVE_PROMO_MASK) >> MOVE_PROMO_SHIFT;
      pos.board[to] = promoPiece;
      lo ^= zobPiecesLo[promoPiece][to];
      hi ^= zobPiecesHi[promoPiece][to];
    }

    else if (move & MOVE_FLAG_KING) {
      pos.kings[piece >> 3] = to;
      lo ^= pieceZobLo[to];
      hi ^= pieceZobHi[to];
    }

    else if (move & MOVE_FLAG_EPMAKE) {
      pos.ep = pos.stm === WHITE ? to - 16 : to + 16;
      lo ^= pieceZobLo[to];
      hi ^= pieceZobHi[to];
    }

    else if (move & MOVE_FLAG_EPCAPTURE) {
      const capSq = pos.stm === WHITE ? to - 16 : to + 16;
      const capPiece = pos.board[capSq];
      lo ^= zobPiecesLo[capPiece][capSq];
      hi ^= zobPiecesHi[capPiece][capSq];
      pos.board[capSq] = 0;
      lo ^= pieceZobLo[to];
      hi ^= pieceZobHi[to];
    }

    else if (move & MOVE_FLAG_KCASTLE) {
      pos.kings[piece >> 3] = to;
      const rook = pos.board[to + 1];
      const rookZobLo = zobPiecesLo[rook];
      const rookZobHi = zobPiecesHi[rook];
      lo ^= rookZobLo[to + 1] ^ rookZobLo[to - 1];
      hi ^= rookZobHi[to + 1] ^ rookZobHi[to - 1];
      pos.board[to - 1] = rook;
      pos.board[to + 1] = 0;
      lo ^= pieceZobLo[to];
      hi ^= pieceZobHi[to];
    }

    else if (move & MOVE_FLAG_QCASTLE) {
      pos.kings[piece >> 3] = to;
      const rook = pos.board[to - 2];
      const rookZobLo = zobPiecesLo[rook];
      const rookZobHi = zobPiecesHi[rook];
      lo ^= rookZobLo[to - 2] ^ rookZobLo[to + 1];
      hi ^= rookZobHi[to - 2] ^ rookZobHi[to + 1];
      pos.board[to + 1] = rook;
      pos.board[to - 2] = 0;
      lo ^= pieceZobLo[to];
      hi ^= pieceZobHi[to];
    }
  }
  else {
    lo ^= pieceZobLo[to];
    hi ^= pieceZobHi[to];
  }

  pos.rights &= RIGHTS_MASK[from] & RIGHTS_MASK[to];

  // update rights hash
  if (pos.rights !== oldRights) {
    lo ^= zobRightsLo[oldRights] ^ zobRightsLo[pos.rights];
    hi ^= zobRightsHi[oldRights] ^ zobRightsHi[pos.rights];
  }

  // update ep hash
  if (oldEp) {
    lo ^= zobEpLo[oldEp];
    hi ^= zobEpHi[oldEp];
  }
  if (pos.ep) {
    lo ^= zobEpLo[pos.ep];
    hi ^= zobEpHi[pos.ep];
  }

  // toggle stm
  lo ^= zobBlackLo;
  hi ^= zobBlackHi;

  pos.stm ^= BLACK;
  pos.hashLo = lo >>> 0;
  pos.hashHi = hi >>> 0;

}

// pass the move: toggle stm and clear ep
function makeNull(pos) {

  let lo = pos.hashLo ^ zobBlackLo;
  let hi = pos.hashHi ^ zobBlackHi;

  if (pos.ep) {
    lo ^= zobEpLo[pos.ep];
    hi ^= zobEpHi[pos.ep];
    pos.ep = 0;
  }

  pos.hmc++;
  pos.stm ^= BLACK;
  pos.hashLo = lo >>> 0;
  pos.hashHi = hi >>> 0;

}

// list the legal moves, or checkmate/stalemate if there are none - handy for web pages
function printMoves() {

  const node = nodes[0];
  const pos = node.pos;
  const nextPos = nodes[1].pos;
  const stmi = pos.stm >> 3;
  const nstm = pos.stm ^ BLACK;

  genMoves(node);

  let str = '';

  for (let i = 0; i < node.numMoves; i++) {
    const move = node.moves[i];
    posSet(nextPos, pos);
    makeMove(move, nextPos);
    if (!isAttacked(nextPos, nextPos.kings[stmi], nstm))
      str += (str ? ' ' : '') + formatMove(move);
  }

  if (!str)
    str = isAttacked(pos, pos.kings[stmi], nstm) ? 'checkmate' : 'stalemate';

  uciWrite(str);
}

function doMove(uciMove) {

  const node = nodes[0];
  const pos = node.pos;

  genMoves(node);

  for (let i = 0; i < node.numMoves; i++) {
    const move = node.moves[i];
    if (formatMove(move) === uciMove) {
      makeMove(move, pos);
      return;
    }
  }
}

// phase weights by piece, 24 in total at the start with the defaults, see the feature command
const PHASE = new Int16Array(7);  // filled from the defaults in FEATURES at startup, as are the others below
let PHASE_TOTAL = 24;

function phaseTotal() {
  PHASE_TOTAL = Math.max(1, 4 * (PHASE[KNIGHT] + PHASE[BISHOP] + PHASE[ROOK]) + 2 * PHASE[QUEEN]);
}

const MGW = Array(7);
const MGB = Array(7);
const EGW = Array(7);
const EGB = Array(7);

const counts = new Uint8Array(16);

// king shelter penalty by how many ranks ahead of the king the nearest pawn is on a file, 3 = none or far
// only while the other side still has a queen https://www.chessprogramming.org/King_Safety#PawnShield
const SHELTER = new Int16Array(4);

// penalty for the pawns ahead of a king on its file (counted twice) and the two beside it
function shelter(board, king, pawn, dir) {
  const kf = Math.min(Math.max(king & 7, 1), 6);
  let penalty = 0;
  for (let f = kf - 1; f <= kf + 1; f++) {
    let sq = (king & 0x70) + f;
    let d = 0;
    while (d < 3) {
      sq += dir;
      if (sq & 0x88 || board[sq] === pawn)
        break;
      d++;
    }
    penalty += SHELTER[d] * (f === kf ? 2 : 1);
  }
  return penalty;
}

// bonus for the side to move https://www.chessprogramming.org/Tempo
const TEMPO = new Int16Array(1);

// king distance terms for N B R Q, [phase][piece type], per step closer, zero by default so just knobs
// smother is closeness to the enemy king https://www.chessprogramming.org/King_Safety#Tropism
// cuddle is closeness to the own king
// flat arrays and a flag so the loop in evaluate() pays nothing while they are all zero
const SMOTHER_MG = new Int16Array(7);
const SMOTHER_EG = new Int16Array(7);
const CUDDLE_MG = new Int16Array(7);
const CUDDLE_EG = new Int16Array(7);
let KING_TERMS = 0;

function kingTermsInit() {
  KING_TERMS = 0;
  for (let type = KNIGHT; type <= QUEEN; type++)
    if (SMOTHER_MG[type] || SMOTHER_EG[type] || CUDDLE_MG[type] || CUDDLE_EG[type])
      KING_TERMS = 1;
}

// king step distance between two 0x88 squares, indexed by 0x77 + a - b which is unique per square pair
const DIST = new Int8Array(0xef);

function distInitOnce() {
  for (let a = 0; a < 128; a++) {
    if (a & 0x88)
      continue;
    for (let b = 0; b < 128; b++) {
      if (b & 0x88)
        continue;
      DIST[0x77 + a - b] = Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
    }
  }
}

// mop up in pawnless endings: per step of the losing king from the centre, per step the kings are close, the lead needed
const MOPUP = new Int16Array(3);

//
// NOTE: examples/tuner.html carries its own copy of this eval as feature coefficients for gradient
// descent. If you add or change a term here, add it there too; the page checks itself against
// the engine on loading and says if the two disagree.
//
// evaluate() uses material and piece square tables tuned from zero on examples/quiet-labeled.epd with
// examples/tuner.html (Sep 2026, replacing PeSTO https://chessprogramming.org/PeSTO%27s_Evaluation_Function)
// i.e. material and piece-square tables https://www.chessprogramming.org/Piece-Square_Tables
// with a tapered eval https://www.chessprogramming.org/Tapered_Eval
// and a check for insufficient material https://www.chessprogramming.org/Draw_Evaluation
//

function evaluate(node) {

  node.draw = 0;

  const pos = node.pos;
  const board = pos.board;

  counts.fill(0);

  let nw = 0
  let nb = 0;

  let mgW = 0, mgB = 0, egW = 0, egB = 0;
  let phase = 0;

  for (let sq = 0; sq < 128; sq++) {

    if (sq & 0x88)
      continue;

    const piece = board[sq];
    if (!piece)
      continue;

    counts[piece] += 1;

    const type = piece & 7;
    const col = piece & BLACK;

    phase += PHASE[type];

    if (col) { // black
      nb++; // number of black pieces on board
      mgB += MGB[type][sq];
      egB += EGB[type][sq];
    }
    else {
      nw++; // number of white pieces on board
      mgW += MGW[type][sq];
      egW += EGW[type][sq];
    }
  }

  // king distance terms for N B R Q, a second walk so the loop above costs nothing while they are off
  if (KING_TERMS) {
    const wk = pos.kings[0];
    const bk = pos.kings[1];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88)
        continue;
      const piece = board[sq];
      const type = piece & 7;
      if (type < KNIGHT || type > QUEEN)
        continue;
      if (piece & BLACK) {
        const own = 7 - DIST[0x77 + sq - bk];
        const enemy = 7 - DIST[0x77 + sq - wk];
        mgB += CUDDLE_MG[type] * own + SMOTHER_MG[type] * enemy;
        egB += CUDDLE_EG[type] * own + SMOTHER_EG[type] * enemy;
      }
      else {
        const own = 7 - DIST[0x77 + sq - wk];
        const enemy = 7 - DIST[0x77 + sq - bk];
        mgW += CUDDLE_MG[type] * own + SMOTHER_MG[type] * enemy;
        egW += CUDDLE_EG[type] * own + SMOTHER_EG[type] * enemy;
      }
    }
  }

  // king shelter, middlegame only, and only against a queen
  if (counts[QUEEN | BLACK])
    mgW -= shelter(board, pos.kings[0], PAWN, 16);
  if (counts[QUEEN])
    mgB -= shelter(board, pos.kings[1], PAWN | BLACK, -16);

  const n = nw + nb; // number of pieces on board

  if (n === 2) {
    node.draw = 1;
    return 0; // K + k
  }
  else if (n === 3) {
    if (counts[KNIGHT] || counts[BISHOP] || counts[KNIGHT|BLACK] || counts[BISHOP|BLACK]) {
      node.draw = 1;
      return 0; // Kk + BbNn
    }
  }

  // mop-up: with no pawns the side well ahead pushes the other king to the edge and brings its king up
  // https://www.chessprogramming.org/Mop-up_Evaluation
  if (counts[PAWN] + counts[PAWN | BLACK] === 0 && Math.abs(egW - egB) >= MOPUP[2]) {
    const wk = pos.kings[0];
    const bk = pos.kings[1];
    const lk = egW > egB ? bk : wk;
    const centre = (Math.abs(2 * (lk & 7) - 7) + Math.abs(2 * (lk >> 4) - 7) - 2) >> 1; // 0 centre to 6 corner
    const apart = Math.abs((wk & 7) - (bk & 7)) + Math.abs((wk >> 4) - (bk >> 4));     // manhattan 2 to 14
    const bonus = MOPUP[0] * centre + MOPUP[1] * (14 - apart);
    if (egW > egB) {
      mgW += bonus;
      egW += bonus;
    }
    else {
      mgB += bonus;
      egB += bonus;
    }
  }

  const mgScore = pos.stm ? mgB - mgW : mgW - mgB;
  const egScore = pos.stm ? egB - egW : egW - egB;

  if (phase > PHASE_TOTAL)
    phase = PHASE_TOTAL;

  const e = Math.trunc((mgScore * phase + egScore * (PHASE_TOTAL - phase)) / PHASE_TOTAL);

  return e + TEMPO[0];
}

// material by piece, MAT[colour index][phase 0 mg 1 eg], per colour so a style can be asymmetric
// filled from DEF_MAT at startup
const MAT = [[new Int16Array(7), new Int16Array(7)], [new Int16Array(7), new Int16Array(7)]];


const PAWN_MG = new Int16Array([
     0,    0,    0,    0,    0,    0,    0,    0,   0, 0, 0, 0, 0, 0, 0, 0,
   -61,  -18,  -35,  -52,  -55,   -3,   11,  -50,   0, 0, 0, 0, 0, 0, 0, 0,
   -50,  -21,  -17,  -28,  -18,  -14,   13,  -37,   0, 0, 0, 0, 0, 0, 0, 0,
   -53,  -20,  -18,   -5,   -4,  -11,  -12,  -50,   0, 0, 0, 0, 0, 0, 0, 0,
   -38,   -2,   -6,   10,   13,   -2,    5,  -44,   0, 0, 0, 0, 0, 0, 0, 0,
   -27,  -10,   13,   17,   57,   49,    4,  -39,   0, 0, 0, 0, 0, 0, 0, 0,
    79,  141,   61,  116,   94,  142,   22,  -47,   0, 0, 0, 0, 0, 0, 0, 0,
     0,    0,    0,    0,    0,    0,    0,    0,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const PAWN_EG = new Int16Array([
     0,    0,    0,    0,    0,    0,    0,    0,   0, 0, 0, 0, 0, 0, 0, 0,
   -25,  -36,  -36,  -27,  -21,  -43,  -44,  -49,   0, 0, 0, 0, 0, 0, 0, 0,
   -36,  -36,  -53,  -41,  -43,  -51,  -50,  -52,   0, 0, 0, 0, 0, 0, 0, 0,
   -26,  -34,  -49,  -53,  -53,  -55,  -43,  -43,   0, 0, 0, 0, 0, 0, 0, 0,
    -8,  -21,  -32,  -43,  -51,  -43,  -30,  -25,   0, 0, 0, 0, 0, 0, 0, 0,
    55,   60,   41,   22,    6,    2,   39,   44,   0, 0, 0, 0, 0, 0, 0, 0,
   149,  132,  121,   88,  103,   87,  137,  170,   0, 0, 0, 0, 0, 0, 0, 0,
     0,    0,    0,    0,    0,    0,    0,    0,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const KNIGHT_MG = new Int16Array([
   -80,    8,  -41,  -27,  -13,  -31,   -9,  -27,   0, 0, 0, 0, 0, 0, 0, 0,
    -4,  -38,   -4,   -7,  -12,    5,  -23,  -25,   0, 0, 0, 0, 0, 0, 0, 0,
    -4,    0,    8,    2,    4,    3,   11,  -22,   0, 0, 0, 0, 0, 0, 0, 0,
     4,   14,    7,   -1,   15,    5,    2,  -24,   0, 0, 0, 0, 0, 0, 0, 0,
    17,   20,   14,   42,   20,   57,    4,    9,   0, 0, 0, 0, 0, 0, 0, 0,
    -9,   76,   39,   59,   85,  119,   62,   28,   0, 0, 0, 0, 0, 0, 0, 0,
   -42,  -17,   88,   30,   24,   63,   -6,   -7,   0, 0, 0, 0, 0, 0, 0, 0,
  -162,  -77,  -39,  -42,   75, -116,  -11, -101,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const KNIGHT_EG = new Int16Array([
   -17,  -51,   -7,   -1,   -8,   -3,  -39,  -48,   0, 0, 0, 0, 0, 0, 0, 0,
   -30,   -4,    7,   13,   16,   -1,   -3,  -30,   0, 0, 0, 0, 0, 0, 0, 0,
   -11,   13,   16,   34,   31,   13,    0,   -5,   0, 0, 0, 0, 0, 0, 0, 0,
    -4,   11,   38,   47,   36,   40,   29,    1,   0, 0, 0, 0, 0, 0, 0, 0,
    -6,   21,   43,   41,   42,   30,   27,    1,   0, 0, 0, 0, 0, 0, 0, 0,
   -16,  -10,   27,   24,    9,    4,   -6,  -25,   0, 0, 0, 0, 0, 0, 0, 0,
   -15,    6,  -14,   15,    5,  -12,   -4,  -37,   0, 0, 0, 0, 0, 0, 0, 0,
   -38,  -22,    8,  -13,  -25,   -9,  -52,  -78,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const BISHOP_MG = new Int16Array([
    -7,   16,   -8,  -19,  -19,  -17,  -45,  -23,   0, 0, 0, 0, 0, 0, 0, 0,
    28,   27,   17,  -10,   -4,    0,   26,   -8,   0, 0, 0, 0, 0, 0, 0, 0,
    16,   22,    9,    2,   -6,    9,   -1,    0,   0, 0, 0, 0, 0, 0, 0, 0,
     7,   18,    1,    5,   13,   -4,  -11,  -13,   0, 0, 0, 0, 0, 0, 0, 0,
    13,    1,    7,   35,   21,   17,   -6,  -19,   0, 0, 0, 0, 0, 0, 0, 0,
    -7,   37,   37,   27,   23,   34,   16,  -20,   0, 0, 0, 0, 0, 0, 0, 0,
    -7,   36,  -13,  -28,   26,   52,   31,  -53,   0, 0, 0, 0, 0, 0, 0, 0,
    -4,    7, -105,  -66,  -52,  -62,   -6,    7,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const BISHOP_EG = new Int16Array([
   -28,  -14,  -26,   -1,   -3,  -12,   -1,  -15,   0, 0, 0, 0, 0, 0, 0, 0,
   -20,  -20,   -4,    8,   10,    1,  -15,  -25,   0, 0, 0, 0, 0, 0, 0, 0,
   -14,   -2,   15,   17,   23,   11,    4,  -10,   0, 0, 0, 0, 0, 0, 0, 0,
    -7,    3,   22,   30,   19,   19,    7,    0,   0, 0, 0, 0, 0, 0, 0, 0,
    -7,   15,   20,   19,   25,   19,   11,   11,   0, 0, 0, 0, 0, 0, 0, 0,
     0,   -7,    4,    5,    5,   12,   10,   11,   0, 0, 0, 0, 0, 0, 0, 0,
   -14,   -8,   11,   -1,    0,   -9,   -5,   -8,   0, 0, 0, 0, 0, 0, 0, 0,
   -25,  -23,    2,    0,    4,   -3,  -16,  -29,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const ROOK_MG = new Int16Array([
   -10,    0,   22,   36,   40,   35,   -2,    4,   0, 0, 0, 0, 0, 0, 0, 0,
   -50,  -14,  -12,    0,   13,   30,   15,  -60,   0, 0, 0, 0, 0, 0, 0, 0,
   -56,  -32,  -18,  -23,    1,    1,    2,  -34,   0, 0, 0, 0, 0, 0, 0, 0,
   -52,  -39,  -24,  -14,  -12,  -17,   -4,  -37,   0, 0, 0, 0, 0, 0, 0, 0,
   -32,  -29,   -9,    2,  -12,   10,  -34,  -47,   0, 0, 0, 0, 0, 0, 0, 0,
   -11,    8,   11,    3,  -24,   13,   37,  -17,   0, 0, 0, 0, 0, 0, 0, 0,
    30,   22,   53,   47,   60,   55,  -17,   23,   0, 0, 0, 0, 0, 0, 0, 0,
    39,   52,   11,   53,   45,  -35,   -6,    7,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const ROOK_EG = new Int16Array([
   -17,   -6,   -6,   -8,  -11,  -20,   -8,  -33,   0, 0, 0, 0, 0, 0, 0, 0,
    -6,  -10,   -3,    1,  -10,  -13,  -18,   -1,   0, 0, 0, 0, 0, 0, 0, 0,
    -2,    2,   -4,    4,   -4,   -9,   -9,  -12,   0, 0, 0, 0, 0, 0, 0, 0,
     7,   10,   13,   10,    5,    2,   -5,   -3,   0, 0, 0, 0, 0, 0, 0, 0,
     5,    8,   18,    8,   13,    7,    9,   14,   0, 0, 0, 0, 0, 0, 0, 0,
     4,    6,    7,   12,   14,    1,   -6,    2,   0, 0, 0, 0, 0, 0, 0, 0,
     0,    7,    3,    5,  -11,   -4,   14,    1,   0, 0, 0, 0, 0, 0, 0, 0,
    -2,   -7,   12,   -1,    2,   15,    5,    3,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const QUEEN_MG = new Int16Array([
    51,   31,   36,   52,   21,   12,    6,   -3,   0, 0, 0, 0, 0, 0, 0, 0,
     1,   21,   39,   23,   28,   33,   28,   27,   0, 0, 0, 0, 0, 0, 0, 0,
     7,   16,   -3,    1,   -5,    4,   17,    8,   0, 0, 0, 0, 0, 0, 0, 0,
    -4,  -32,  -21,  -22,  -19,  -17,  -14,  -13,   0, 0, 0, 0, 0, 0, 0, 0,
   -20,  -40,  -39,  -46,  -35,  -24,  -35,  -31,   0, 0, 0, 0, 0, 0, 0, 0,
     1,  -12,  -11,  -37,  -21,   11,    2,    9,   0, 0, 0, 0, 0, 0, 0, 0,
    -2,  -37,  -22,  -33,  -83,   25,    7,   35,   0, 0, 0, 0, 0, 0, 0, 0,
   -11,   -5,  -10,  -24,   61,   64,   21,   31,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const QUEEN_EG = new Int16Array([
   -46,  -38,  -23,  -44,   11,   -9,  -13,  -40,   0, 0, 0, 0, 0, 0, 0, 0,
   -32,  -35,  -40,  -16,   -8,  -13,  -37,  -35,   0, 0, 0, 0, 0, 0, 0, 0,
   -15,  -45,    7,   -5,    9,   16,   11,    5,   0, 0, 0, 0, 0, 0, 0, 0,
    -8,   41,   17,   40,   24,   22,   25,    2,   0, 0, 0, 0, 0, 0, 0, 0,
    19,   37,   27,   41,   45,   27,   45,   22,   0, 0, 0, 0, 0, 0, 0, 0,
   -15,    5,    0,   43,   39,    5,    3,  -16,   0, 0, 0, 0, 0, 0, 0, 0,
   -24,   14,   20,   24,   56,  -14,   -1,  -33,   0, 0, 0, 0, 0, 0, 0, 0,
   -17,   14,   13,    8,  -37,  -47,  -22,   -6,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const KING_MG = new Int16Array([
   -26,   21,   -3,  -86,  -25,  -56,   18,   16,   0, 0, 0, 0, 0, 0, 0, 0,
    31,   34,   17,  -36,  -17,   18,   51,   45,   0, 0, 0, 0, 0, 0, 0, 0,
    16,   29,   26,   -6,   -4,    6,   40,   -4,   0, 0, 0, 0, 0, 0, 0, 0,
   -38,   65,    5,  -35,  -36,   -8,  -11,  -44,   0, 0, 0, 0, 0, 0, 0, 0,
    25,   36,   60,   29,   36,   23,   32,  -45,   0, 0, 0, 0, 0, 0, 0, 0,
    39,   69,  101,   60,   95,  127,  121,   -9,   0, 0, 0, 0, 0, 0, 0, 0,
   154,   69,   60,  118,   60,   25,  -45, -149,   0, 0, 0, 0, 0, 0, 0, 0,
  -158,  106,  106,   55, -120,  -96,  -10,   -5,   0, 0, 0, 0, 0, 0, 0, 0,
]);

const KING_EG = new Int16Array([
   -58,  -39,  -19,    2,  -17,    1,  -28,  -59,   0, 0, 0, 0, 0, 0, 0, 0,
   -37,  -17,    4,   16,   17,    3,  -15,  -32,   0, 0, 0, 0, 0, 0, 0, 0,
   -25,   -7,    8,   22,   25,   17,    0,   -9,   0, 0, 0, 0, 0, 0, 0, 0,
   -16,  -12,   21,   32,   35,   26,   14,   -5,   0, 0, 0, 0, 0, 0, 0, 0,
   -14,   17,   16,   24,   21,   32,   24,   10,   0, 0, 0, 0, 0, 0, 0, 0,
    -1,   11,    7,    6,    3,   26,   27,   13,   0, 0, 0, 0, 0, 0, 0, 0,
   -44,    2,    2,   -7,    4,   34,   31,   34,   0, 0, 0, 0, 0, 0, 0, 0,
   -53,  -57,  -42,  -34,    7,   23,    2,  -22,   0, 0, 0, 0, 0, 0, 0, 0,
]);

// the default tables from white's side, indexed by piece, tuned from zero with examples/tuner.html
const DEF_MG = [null, PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
const DEF_EG = [null, PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

// the live tables, PST[colour index][phase 0 mg 1 eg][piece][0x88 square], absolute squares
// for both colours, so the black defaults are the white ones flipped; edited with the pst command
const PST = [[Array(7), Array(7)], [Array(7), Array(7)]];

// reset one table to its default
function pstDefault(c, ph, piece) {
  const def = ph ? DEF_EG[piece] : DEF_MG[piece];
  const t = PST[c][ph][piece];
  for (let sq = 0; sq < 128; sq++) {
    if (!(sq & 0x88))
      t[sq] = def[c ? sq ^ 0x70 : sq];
  }
}

// fold material into the tables the eval reads, for one piece
function evalInit(piece) {
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88)
      continue;
    MGW[piece][sq] = MAT[0][0][piece] + PST[0][0][piece][sq];
    MGB[piece][sq] = MAT[1][0][piece] + PST[1][0][piece][sq];
    EGW[piece][sq] = MAT[0][1][piece] + PST[0][1][piece][sq];
    EGB[piece][sq] = MAT[1][1][piece] + PST[1][1][piece][sq];
  }
}

function evalInitOnce() {
  for (let piece = 1; piece <= 6; piece++) {
    MGW[piece] = new Int16Array(128);
    MGB[piece] = new Int16Array(128);
    EGW[piece] = new Int16Array(128);
    EGB[piece] = new Int16Array(128);
    for (let c = 0; c < 2; c++) {
      for (let ph = 0; ph < 2; ph++) {
        PST[c][ph][piece] = new Int16Array(128);
        pstDefault(c, ph, piece);
      }
    }
    evalInit(piece);
  }
}

// one table as a line the pst command accepts back, e.g. "pst wn mg <64 values a1..h8>"
function printPst(c, ph, piece) {
  let line = 'pst ' + (c ? 'b' : 'w') + 'pnbrqk'[piece - 1] + (ph ? ' eg' : ' mg');
  for (let sq = 0; sq < 128; sq++) {
    if (!(sq & 0x88))
      line += ' ' + PST[c][ph][piece][sq];
  }
  uciWrite(line);
}

// pst                                        print all the tables
// pst def                                    reset all the tables
// pst <piece> [mg|eg] [def|<sq>|<sq> <v>|<64 v>]  print, reset or set, <piece> is p n b r q k
//   for both colours mirrored, or wn bq etc for one colour as absolute squares, values a1..h8
//   a square on its own prints its values, white then black and mg then eg as far as asked
// https://www.chessprogramming.org/Piece-Square_Tables
function pstCommand(tokens) {
  const t = [];
  for (let i = 1; i < tokens.length; i++)
    t.push(tokens[i].toLowerCase());
  const all = t.length === 0 || t.length === 1 && t[0] === 'def';
  let colours = [0, 1];
  let pieces = [1, 2, 3, 4, 5, 6];
  let phases = [0, 1];
  let i = 0;
  if (!all) {
    let p = t[0];
    if (p.length === 2 && (p[0] === 'w' || p[0] === 'b')) {
      colours = [p[0] === 'w' ? 0 : 1];
      p = p[1];
    }
    const piece = 'pnbrqk'.indexOf(p) + 1;
    if (!piece || p.length !== 1) {
      uciWrite('info string pst: unknown piece ' + t[0]);
      return;
    }
    pieces = [piece];
    i = 1;
    if (t[i] === 'mg' || t[i] === 'eg')
      phases = [t[i++] === 'mg' ? 0 : 1];
  }
  const rest = t.slice(i);
  const mirror = colours.length === 2;  // no colour given, black gets the white square flipped
  if (rest.length === 0) {
    for (let a = 0; a < pieces.length; a++)
      for (let b = 0; b < colours.length; b++)
        for (let d = 0; d < phases.length; d++)
          printPst(colours[b], phases[d], pieces[a]);
    return;
  }
  if (rest.length === 1 && /^[a-h][1-8]$/.test(rest[0])) {
    const sq = (rest[0].charCodeAt(1) - 49) * 16 + rest[0].charCodeAt(0) - 97;
    let line = 'pst ' + t.slice(0, i).join(' ') + ' ' + rest[0];
    for (let b = 0; b < colours.length; b++)
      for (let d = 0; d < phases.length; d++)
        line += ' ' + PST[colours[b]][phases[d]][pieces[0]][mirror && colours[b] ? sq ^ 0x70 : sq];
    uciWrite(line);
    return;
  }
  if (rest.length === 1 && rest[0] === 'def') {
    for (let a = 0; a < pieces.length; a++)
      for (let b = 0; b < colours.length; b++)
        for (let d = 0; d < phases.length; d++)
          pstDefault(colours[b], phases[d], pieces[a]);
  }
  else if (rest.length === 2 && /^[a-h][1-8]$/.test(rest[0]) && /^-?\d+$/.test(rest[1])) {
    const sq = (rest[0].charCodeAt(1) - 49) * 16 + rest[0].charCodeAt(0) - 97;
    for (let b = 0; b < colours.length; b++)
      for (let d = 0; d < phases.length; d++)
        PST[colours[b]][phases[d]][pieces[0]][mirror && colours[b] ? sq ^ 0x70 : sq] = parseInt(rest[1]);
  }
  else if (rest.length === 64) {
    for (let j = 0; j < 64; j++) {
      if (!/^-?\d+$/.test(rest[j])) {
        uciWrite('info string pst: bad value ' + rest[j]);
        return;
      }
    }
    for (let b = 0; b < colours.length; b++) {
      for (let d = 0; d < phases.length; d++) {
        for (let j = 0; j < 64; j++) {
          const sq = (j >> 3) * 16 + (j & 7);
          PST[colours[b]][phases[d]][pieces[0]][mirror && colours[b] ? sq ^ 0x70 : sq] = parseInt(rest[j]);
        }
      }
    }
  }
  else {
    uciWrite('info string pst: expected def, a square and a value, or 64 values');
    return;
  }
  for (let a = 0; a < pieces.length; a++)
    evalInit(pieces[a]);
  ttClear();  // scores in the hash were for the old eval
}

// eval verbose: the eval itemised from white's side, then the real eval as a check
// walks the board again rather than slowing evaluate() down with bookkeeping
function evalVerbose(node) {

  const pos = node.pos;
  const board = pos.board;
  const mat = [[0, 0], [0, 0]];  // [colour][phase]
  const pst = [[0, 0], [0, 0]];
  const smo = [[0, 0], [0, 0]];
  const cud = [[0, 0], [0, 0]];
  const shel = [0, 0];
  const mop = [0, 0];
  let phase = 0;
  let n = 0;

  counts.fill(0);
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88 || !board[sq])
      continue;
    const piece = board[sq];
    const type = piece & 7;
    const c = piece >> 3;
    counts[piece] += 1;
    n++;
    phase += PHASE[type];
    for (let ph = 0; ph < 2; ph++) {
      mat[c][ph] += MAT[c][ph][type];
      pst[c][ph] += PST[c][ph][type][sq];
      if (type >= KNIGHT && type <= QUEEN) {
        smo[c][ph] += (ph ? SMOTHER_EG : SMOTHER_MG)[type] * (7 - DIST[0x77 + sq - pos.kings[c ^ 1]]);
        cud[c][ph] += (ph ? CUDDLE_EG : CUDDLE_MG)[type] * (7 - DIST[0x77 + sq - pos.kings[c]]);
      }
    }
  }

  if (counts[QUEEN | BLACK])
    shel[0] = -shelter(board, pos.kings[0], PAWN, 16);
  if (counts[QUEEN])
    shel[1] = -shelter(board, pos.kings[1], PAWN | BLACK, -16);

  const draw = n === 2 || n === 3 && (counts[KNIGHT] || counts[BISHOP] || counts[KNIGHT | BLACK] || counts[BISHOP | BLACK]);

  const egW = mat[0][1] + pst[0][1] + smo[0][1] + cud[0][1];
  const egB = mat[1][1] + pst[1][1] + smo[1][1] + cud[1][1];
  if (!draw && counts[PAWN] + counts[PAWN | BLACK] === 0 && Math.abs(egW - egB) >= MOPUP[2]) {
    const wk = pos.kings[0];
    const bk = pos.kings[1];
    const lk = egW > egB ? bk : wk;
    const centre = (Math.abs(2 * (lk & 7) - 7) + Math.abs(2 * (lk >> 4) - 7) - 2) >> 1;
    const apart = Math.abs((wk & 7) - (bk & 7)) + Math.abs((wk >> 4) - (bk >> 4));
    mop[egW > egB ? 0 : 1] = MOPUP[0] * centre + MOPUP[1] * (14 - apart);
  }

  function row(name, w0, w1, b0, b1, d0, d1) {
    uciWrite(name.padEnd(9) + String(w0).padStart(9) + String(w1).padStart(9) + String(b0).padStart(9) + String(b1).padStart(9)
      + String(d0 === undefined ? w0 - b0 : d0).padStart(9) + String(d1 === undefined ? w1 - b1 : d1).padStart(9));
  }

  row('term', 'white mg', 'white eg', 'black mg', 'black eg', 'mg', 'eg');
  row('material', mat[0][0], mat[0][1], mat[1][0], mat[1][1]);
  row('pst', pst[0][0], pst[0][1], pst[1][0], pst[1][1]);
  row('smother', smo[0][0], smo[0][1], smo[1][0], smo[1][1]);
  row('cuddle', cud[0][0], cud[0][1], cud[1][0], cud[1][1]);
  row('shelter', shel[0], 0, shel[1], 0);
  row('mopup', mop[0], mop[0], mop[1], mop[1]);
  const tw0 = mat[0][0] + pst[0][0] + smo[0][0] + cud[0][0] + shel[0] + mop[0];
  const tw1 = egW + mop[0];
  const tb0 = mat[1][0] + pst[1][0] + smo[1][0] + cud[1][0] + shel[1] + mop[1];
  const tb1 = egB + mop[1];
  row('total', tw0, tw1, tb0, tb1);

  if (phase > PHASE_TOTAL)
    phase = PHASE_TOTAL;
  uciWrite('phase ' + phase + ' of ' + PHASE_TOTAL);
  const blend = Math.trunc(((tw0 - tb0) * phase + (tw1 - tb1) * (PHASE_TOTAL - phase)) / PHASE_TOTAL);
  uciWrite('blend ' + blend + ' for white');
  uciWrite('tempo ' + TEMPO[0] + ' for ' + (pos.stm ? 'black' : 'white') + ' to move');
  if (draw)
    uciWrite('draw by material');
  uciWrite('eval ' + evaluate(node));
}

// the tunable eval features other than the tables: name => [live array, first index, defaults]
// material is wmat and bmat with a phase, MAT[colour][phase] from PAWN to QUEEN
const FEATURES = {
  tempo:   [TEMPO, 0, [18]],
  phase:   [PHASE, KNIGHT, [1, 1, 2, 4]],
  shelter: [SHELTER, 0, [0, 9, 8, 20]],
  mopup:   [MOPUP, 0, [10, 8, 200]]
};
const DEF_MAT = [[100, 300, 347, 491, 1018], [139, 279, 308, 532, 907]];
// features with a middlegame and an endgame list, knight to queen: name => [[mg array, eg array], first index, [mg defaults, eg defaults]]
const PHASED = {
  smother: [[SMOTHER_MG, SMOTHER_EG], KNIGHT, [[12, 9, 13, 19], [-4, -4, -5, 11]]],
  cuddle:  [[CUDDLE_MG, CUDDLE_EG], KNIGHT, [[12, 10, -5, 4], [-4, -4, -2, -10]]]
};

// print "<cmd> <name> <values>" for one entry of a feature or search list
function printNumbers(cmd, name, arr, first, n) {
  let line = cmd + ' ' + name;
  for (let i = 0; i < n; i++)
    line += ' ' + arr[first + i];
  uciWrite(line);
}

// set every [name, array, first, defaults] in list from rest, the values or def, checking first
function setNumbers(cmd, list, rest) {
  const values = rest.length === 1 && rest[0] === 'def' ? null : rest;
  for (let j = 0; j < list.length; j++) {
    if (values && values.length !== list[j][3].length) {
      uciWrite('info string ' + cmd + ': ' + list[j][0] + ' takes ' + list[j][3].length + ' values');
      return false;
    }
  }
  for (let k = 0; values && k < values.length; k++) {
    if (!/^-?\d+$/.test(values[k])) {
      uciWrite('info string ' + cmd + ': bad value ' + values[k]);
      return false;
    }
  }
  for (let j = 0; j < list.length; j++) {
    const arr = list[j][1];
    const first = list[j][2];
    const def = list[j][3];
    for (let k = 0; k < def.length; k++)
      arr[first + k] = values ? parseInt(values[k]) : def[k];
  }
  return true;
}

// feature                         print all
// feature def                     reset all
// feature <name> [def|<values>]   print, reset or set one, <name> is tempo phase shelter mopup or
//   mat wmat bmat followed by mg or eg, mat being both colours; values are all given at once
function featureCommand(tokens) {
  const t = [];
  for (let i = 1; i < tokens.length; i++)
    t.push(tokens[i].toLowerCase());
  // build the list of [name, array, first, defaults] to act on
  const list = [];
  let i = 0;
  if (t.length === 0 || t.length === 1 && t[0] === 'def') {
    for (const name in FEATURES)
      list.push([name, FEATURES[name][0], FEATURES[name][1], FEATURES[name][2]]);
    for (const name in PHASED)
      for (let ph = 0; ph < 2; ph++)
        list.push([name + (ph ? ' eg' : ' mg'), PHASED[name][0][ph], PHASED[name][1], PHASED[name][2][ph]]);
    for (let c = 0; c < 2; c++)
      for (let ph = 0; ph < 2; ph++)
        list.push([(c ? 'bmat' : 'wmat') + (ph ? ' eg' : ' mg'), MAT[c][ph], PAWN, DEF_MAT[ph]]);
  }
  else if (FEATURES[t[0]]) {
    list.push([t[0], FEATURES[t[0]][0], FEATURES[t[0]][1], FEATURES[t[0]][2]]);
    i = 1;
  }
  else if (PHASED[t[0]] && (t[1] === 'mg' || t[1] === 'eg')) {
    const ph = t[1] === 'eg' ? 1 : 0;
    list.push([t[0] + ' ' + t[1], PHASED[t[0]][0][ph], PHASED[t[0]][1], PHASED[t[0]][2][ph]]);
    i = 2;
  }
  else if ((t[0] === 'mat' || t[0] === 'wmat' || t[0] === 'bmat') && (t[1] === 'mg' || t[1] === 'eg')) {
    const ph = t[1] === 'eg' ? 1 : 0;
    for (let c = 0; c < 2; c++)
      if (t[0] === 'mat' || t[0][0] === (c ? 'b' : 'w'))
        list.push([(c ? 'bmat' : 'wmat') + ' ' + t[1], MAT[c][ph], PAWN, DEF_MAT[ph]]);
    i = 2;
  }
  else {
    uciWrite('info string feature: unknown feature ' + t.join(' '));
    return;
  }
  const rest = t.slice(i);
  if (rest.length === 0) {
    for (let j = 0; j < list.length; j++)
      printNumbers('feature', list[j][0], list[j][1], list[j][2], list[j][3].length);
    return;
  }
  if (!setNumbers('feature', list, rest))
    return;
  phaseTotal();
  kingTermsInit();
  for (let piece = PAWN; piece <= KING; piece++)
    evalInit(piece);
  ttClear();  // scores in the hash were for the old eval
}

// search parameters, edited with the search command, filled from the defaults in SEARCHES at startup
const RFP = new Int16Array(2);        // reverse futility: max depth, margin per depth
const NULLMOVE = new Int16Array(3);   // null move: min depth, reduction, plus depth divided by
const FUTILITY = new Int16Array(2);   // futility: max depth, margin per depth
const LMR = new Int16Array(5);        // late move reduction: min depth, after n moves reduce by, after n moves reduce by
const ASPIRATION = new Int16Array(3); // aspiration window: from depth, width, doubled until, then wide open
const TIME = new Int16Array(5);       // clock: moves to go if not given, soft and hard limits as % of the
                                      // allocation, hard limit cap as % of time left, % of increment used
const SEARCHES = {
  rfp:        [RFP, 0, [8, 100]],
  nullmove:   [NULLMOVE, 0, [2, 2, 4]],
  futility:   [FUTILITY, 0, [3, 100]],
  lmr:        [LMR, 0, [3, 3, 1, 12, 2]],
  aspiration: [ASPIRATION, 0, [4, 30, 500]],
  time:       [TIME, 0, [30, 50, 300, 50, 50]]
};

// search                          print all
// search def                      reset all
// search <name> [def|<values>]    print, reset or set one, values all given at once
function searchCommand(tokens) {
  const t = [];
  for (let i = 1; i < tokens.length; i++)
    t.push(tokens[i].toLowerCase());
  const list = [];
  let i = 0;
  if (t.length === 0 || t.length === 1 && t[0] === 'def') {
    for (const name in SEARCHES)
      list.push([name, SEARCHES[name][0], SEARCHES[name][1], SEARCHES[name][2]]);
  }
  else if (SEARCHES[t[0]]) {
    list.push([t[0], SEARCHES[t[0]][0], SEARCHES[t[0]][1], SEARCHES[t[0]][2]]);
    i = 1;
  }
  else {
    uciWrite('info string search: unknown parameter ' + t[0]);
    return;
  }
  const rest = t.slice(i);
  if (rest.length === 0) {
    for (let j = 0; j < list.length; j++)
      printNumbers('search', list[j][0], list[j][1], list[j][2], list[j][3].length);
    return;
  }
  setNumbers('search', list, rest);
}

class TimeControl {

  constructor() {
    this.bestMove = 0;
    this.nodes = 0;
    this.maxNodes = 0;
    this.maxDepth = 0;
    this.selDepth = 0;
    this.startTime = 0;
    this.softTime = 0;   // don't start a new iteration after this
    this.finishTime = 0; // abort search at this
    this.finished = 0;
  }
}

const timeControl = new TimeControl();

function tcClear() {
  const tc = timeControl;
  tc.bestMove = 0;
  tc.nodes = 0;
  tc.maxNodes = 0;
  tc.maxDepth = 0;
  tc.selDepth = 0;
  tc.startTime = now() | 0;
  tc.softTime = 0;
  tc.finishTime = 0;
  tc.finished = 0;
}

// clock is only read every 512 nodes
function tcCheck() {
  const tc = timeControl;
  if (tc.finishTime && (tc.nodes & 511) === 0 && now() >= tc.finishTime)
    tc.finished = 1;
  else if (tc.maxNodes && tc.nodes >= tc.maxNodes)
    tc.finished = 1;
}

// https://www.chessprogramming.org/Time_Management
function tcInit(tokens) {

  tcClear();

  const tc = timeControl;

  // Parse go command parameters
  let wtime = 0;
  let btime = 0;
  let winc = 0;
  let binc = 0;
  let movestogo = TIME[0]; // if not given
  let movetime = tokens.length === 1 ? 100 : 0; // bare go = quick search
  let infinite = false;

  // Parse tokens
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token) {
      case 'wtime':
        wtime = parseInt(tokens[++i]) || 0;
        break;
      case 'btime':
        btime = parseInt(tokens[++i]) || 0;
        break;
      case 'winc':
        winc = parseInt(tokens[++i]) || 0;
        break;
      case 'binc':
        binc = parseInt(tokens[++i]) || 0;
        break;
      case 'movestogo':
        movestogo = Math.max(2, parseInt(tokens[++i]) || TIME[0]);
        break;
      case 'depth':
      case 'd':
        tc.maxDepth = parseInt(tokens[++i]) || 0;
        break;
      case 'nodes':
      case 'n':
        tc.maxNodes = parseInt(tokens[++i]) || 0;
        break;
      case 'movetime':
      case 'm':
        movetime = parseInt(tokens[++i]) || 0;
        break;
      case 'infinite':
      case 'i':
        infinite = true;
        break;
    }
  }

  // Calculate finish time based on time control
  if (movetime > 0) {
    // Fixed time per move
    tc.finishTime = tc.startTime + movetime;
  }
  else if (!infinite && (wtime > 0 || btime > 0)) {
    // Calculate time allocation based on side to move
    const pos = nodes[0].pos;
    const isWhite = pos.stm === WHITE;
    const timeLeft = isWhite ? wtime : btime;
    const increment = isWhite ? winc : binc;

    // Time allocation: timeLeft / movestogo + a share of the increment
    // The soft limit stops new iterations, the hard limit aborts the search, see TIME
    const allocatedTime = (timeLeft / movestogo) + (increment * TIME[4] / 100);
    tc.softTime = tc.startTime + allocatedTime * TIME[1] / 100;
    tc.finishTime = tc.startTime + Math.min(allocatedTime * TIME[2] / 100, timeLeft * TIME[3] / 100);
  }

  // Set default max depth if not specified
  if (tc.maxDepth <= 0)
    tc.maxDepth = MAX_PLY;
  else if (tc.maxDepth > MAX_PLY)
    tc.maxDepth = MAX_PLY;

}

//
// quiescence search, captures only, with stand pat https://www.chessprogramming.org/Quiescence_Search
//

function qsearch(ply, alpha, beta) {

  if (ply === MAX_PLY - 1)
    return evaluate(nodes[ply]);

  const tc = timeControl;

  tcCheck();
  if (tc.finished)
    return 0;

  tc.nodes++;

  if (ply > tc.selDepth)
    tc.selDepth = ply;

  const node = nodes[ply];
  const pos = node.pos;

  node.pvLen = 0;

  // check tt
  const ttIndex = ttGet(pos);
  if (ttIndex >= 0) {
    const score = ttScoreFromTT(ttGetScore(ttIndex), ply);
    const type = ttGetType(ttIndex);
    if (type === TT_EXACT || (type === TT_BETA && score >= beta) || (type === TT_ALPHA && score <= alpha)) {
      return score;
    }
  }

  // stand pat ?
  const standPat = evaluate(node);
  if (node.draw)
    return 0;
  if (standPat >= beta)
    return standPat;
  if (standPat > alpha)
    alpha = standPat;

  const nextNode = nodes[ply + 1];
  const nextPos = nextNode.pos;
  const stmi = pos.stm >> 3;

  const ttMove = ttIndex >= 0 && (ttGetMove(ttIndex) & MOVE_FLAG_CAPTURE) ? moveIsProbablyLegal(node, ttGetMove(ttIndex)) : 0;

  initNextMoveQS(node, ttMove);

  let move;

  while ((move = getNextMoveQS(node))) {

    posSet(nextPos, pos);
    makeMove(move, nextPos);

    if (isAttacked(nextPos, nextPos.kings[stmi], nextPos.stm))
      continue;

    const score = -qsearch(ply + 1, -beta, -alpha);

    if (tc.finished)
      return 0;

    if (score >= beta)
      return score;

    if (score > alpha)
      alpha = score;
  }

  return alpha;

}

//
// negamax alpha-beta with principal variation search
// https://www.chessprogramming.org/Negamax https://www.chessprogramming.org/Alpha-Beta https://www.chessprogramming.org/Principal_Variation_Search
//

// mate scores are MATE - ply so shorter mates score higher https://www.chessprogramming.org/Checkmate
const MATE = 10000;

function search(depth, ply, alpha, beta) {

  if (ply === MAX_PLY - 1)
    return evaluate(nodes[ply]);

  const tc = timeControl;

  tcCheck();
  if (tc.finished)
    return 0;

  const node = nodes[ply];
  const pos = node.pos;
  const stmi = pos.stm >> 3;
  const nstm = pos.stm ^ BLACK;
  const inCheck = isAttacked(pos, pos.kings[stmi], nstm);

  // in check at depth 0 stays in search rather than qsearch https://www.chessprogramming.org/Check_Extensions
  if (!inCheck && depth <= 0)
    return qsearch(ply, alpha, beta);

  depth = Math.max(depth, 0);

  tc.nodes++;

  const nextNode = nodes[ply + 1];
  const nextPos = nextNode.pos;
  const oAlpha = alpha;
  const isRoot = ply === 0;
  const isPV = isRoot || (beta - alpha !== 1);

  node.pvLen = 0;

  // record position for repetition detection
  repRecord(pos, ply);

  // check tt
  const ttIndex = ttGet(pos);
  if (!isPV && ttIndex >= 0 && ttGetDepth(ttIndex) >= depth) {
    const score = ttScoreFromTT(ttGetScore(ttIndex), ply);
    const type = ttGetType(ttIndex);
    if (type === TT_EXACT || (type === TT_BETA && score >= beta) || (type === TT_ALPHA && score <= alpha)) {
      return score;
    }
  }

  // check for draws
  const ev = evaluate(node); // sets node.draw
  if (!isRoot && (node.draw || isDraw(pos, ply)))
    return 0;

  // beta pruning aka reverse futility pruning https://www.chessprogramming.org/Reverse_Futility_Pruning
  if (!isPV && !inCheck && depth <= RFP[0] && beta < TT_MATE_BOUND && (ev - depth * RFP[1]) >= beta)
    return ev;

  // null move pruning https://www.chessprogramming.org/Null_Move_Pruning
  // counts[] is still valid from evaluate() above
  if (!isPV && !inCheck && !node.noNull && depth >= NULLMOVE[0] && ev >= beta && beta < TT_MATE_BOUND
      && (counts[KNIGHT | pos.stm] + counts[BISHOP | pos.stm] + counts[ROOK | pos.stm] + counts[QUEEN | pos.stm]) > 0) {
    posSet(nextPos, pos);
    makeNull(nextPos);
    nextNode.noNull = 1;
    const score = -search(depth - 1 - NULLMOVE[1] - ((depth / NULLMOVE[2]) | 0), ply + 1, -beta, -beta + 1);
    nextNode.noNull = 0;
    if (tc.finished)
      return 0;
    if (score >= beta)
      return score >= TT_MATE_BOUND ? beta : score;
  }

  const ttMove = ttIndex >= 0 ? moveIsProbablyLegal(node, ttGetMove(ttIndex)) : 0;

  initNextMove(node, ttMove);

  let bestScore = -Infinity;
  let bestMove = 0;
  let numMoves = 0;
  let move;

  while ((move = getNextMove(node))) {

    posSet(nextPos, pos);
    makeMove(move, nextPos);

    if (isAttacked(nextPos, nextPos.kings[stmi], nstm))
      continue;

    numMoves++;

    // futility pruning - at low depth skip quiet moves when the static eval is well below alpha
    // https://www.chessprogramming.org/Futility_Pruning
    if (!isPV && !inCheck && depth <= FUTILITY[0] && numMoves > 1 && Math.abs(alpha) < TT_MATE_BOUND
        && !(move & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK)) && ev + FUTILITY[1] * depth <= alpha)
      continue;

    let score;

    if (numMoves === 1) {
      score = -search(depth - 1, ply + 1, -beta, -alpha);
    }
    else {
      // late move reductions https://www.chessprogramming.org/Late_Move_Reductions
      // late quiet non-killer moves get a reduced null window search first
      let r = 0;
      if (depth >= LMR[0] && numMoves > LMR[1] && !inCheck && move !== node.killer && !(move & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK)))
        r = numMoves > LMR[3] ? LMR[4] : LMR[2];
      score = -search(depth - 1 - r, ply + 1, -alpha - 1, -alpha);
      if (r && tc.finished === 0 && score > alpha) {
        score = -search(depth - 1, ply + 1, -alpha - 1, -alpha);
      }
      if (tc.finished === 0 && score > alpha && score < beta) {
        score = -search(depth - 1, ply + 1, -beta, -alpha);
      }
    }

    if (tc.finished)
      return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }

    if (bestScore > alpha) {
      if (isRoot) {
        tc.bestMove = bestMove;
      }
      alpha = bestScore;
      if (isPV)
        pvCopy(node, nextNode, bestMove);
    }

    if (alpha >= beta) {
      addHistory(pos, bestMove, depth);
      killerSet(node, bestMove);
      ttPut(pos, TT_BETA, depth, ttScoreToTT(bestScore, ply), bestMove);
      return bestScore;
    }
  }

  if (numMoves === 0)
    return inCheck ? -MATE + ply : 0;

  ttPut(pos, bestScore > oAlpha ? TT_EXACT : TT_ALPHA, depth, ttScoreToTT(bestScore, ply), bestMove);

  return bestScore;

}

// node.pv = move followed by child's pv https://www.chessprogramming.org/Triangular_PV-Table
function pvCopy(node, child, move) {
  const pv = node.pv;
  const childPV = child.pv;
  const len = child.pvLen;
  pv[0] = move;
  for (let i = 0; i < len; i++)
    pv[i + 1] = childPV[i];
  node.pvLen = len + 1;
}

function formatPV(node) {
  let str = '';
  for (let i = 0; i < node.pvLen; i++)
    str += (i ? ' ' : '') + formatMove(node.pv[i]);
  return str;
}

// mate in n moves (not plies) as per uci, negative if being mated
function formatScore(score) {
  if (score >= TT_MATE_BOUND)
    return 'mate ' + ((MATE - score + 1) >> 1);
  if (score <= -TT_MATE_BOUND)
    return 'mate ' + (-((MATE + score + 1) >> 1));
  return 'cp ' + score;
}

function newGame() {
  ttClear();
  repClear();
}

// https://www.chessprogramming.org/Iterative_Deepening
function go() {

  const tc = timeControl;

  let score = 0;

  for (let d = 1; d <= tc.maxDepth; d++) {
    const bm = tc.bestMove;
    // aspiration window around the previous score, widened on failure https://www.chessprogramming.org/Aspiration_Windows
    let delta = ASPIRATION[1];
    let alpha = d >= ASPIRATION[0] ? score - delta : -Infinity;
    let beta  = d >= ASPIRATION[0] ? score + delta :  Infinity;
    while (true) {
      score = search(d, 0, alpha, beta);
      if (tc.finished || (score > alpha && score < beta))
        break;
      delta *= 2;
      alpha = delta > ASPIRATION[2] ? -Infinity : score - delta;
      beta  = delta > ASPIRATION[2] ?  Infinity : score + delta;
    }
    if (tc.finished) {
      if (bm)
        tc.bestMove = bm;
      break;
    }
    const time = now() - tc.startTime;
    const nps = (1000 * tc.nodes / time) | 0;
    uciWrite(`info depth ${d} seldepth ${tc.selDepth} score ${formatScore(score)} nodes ${tc.nodes} time ${time} nps ${nps} pv ${formatPV(nodes[0])}`);
    if (tc.softTime && now() >= tc.softTime)
      break;
    // stop once a mate is found - a faster one may exist but this is more fun
    if (score >= TT_MATE_BOUND || score <= -TT_MATE_BOUND)
      break;
  }

  uciWrite(`bestmove ${formatMove(tc.bestMove)}`);
}

const searchNodes = Array(MAX_PLY);

// uses the move iterator and tt to exercise them.
// it also compares the incremental hash to a rebuilt hash

const TT_PERFT = 4;

// https://www.chessprogramming.org/Perft
function perft (depth, ply) {

  if (ply === 0)
    ttClear();

  if (depth === 0)
    return 1;

  const node = nodes[ply];
  const nextNode = nodes[ply+1];
  const pos = node.pos;
  const nextPos = nextNode.pos;
  const stmi = pos.stm >> 3;

  // check incremental hash matches rebuilt hash
  const hashLo = pos.hashLo;
  const hashHi = pos.hashHi;
  zobRebuild(pos)
  if (hashLo != pos.hashLo)
    console.log('*********** lo', hashLo, pos.hashLo);
  if (hashHi != pos.hashHi)
    console.log('************hi', hashHi, pos.hashHi);

  // probe tt
  const ttIndex = ttGet(pos);
  if (ttIndex >= 0 && ttGetType(ttIndex) === TT_PERFT && ttGetDepth(ttIndex) === depth) {
    return ttGetMove(ttIndex); // node count stored in move field
  }

  let tot = 0;

  initNextMove(node, 0);

  let move;

  while ((move = getNextMove(node))) {
    posSet(nextPos, pos);
    makeMove(move, nextPos);
    if (isAttacked(nextPos, nextPos.kings[stmi], nextPos.stm))
      continue;
    tot += perft(depth-1, ply+1);
  }

  if (depth > 2) // false positives otherwise
    ttPut(pos, TT_PERFT, depth, 0, tot);

  return tot;

}

const PERFT_POSITIONS = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2, 400, 'cpw-pos1-2'],
  ['4k3/8/8/8/8/8/R7/R3K2R w Q - 0 1', 3, 4729, 'castling-2'],
  ['4k3/8/8/8/8/8/R7/R3K2R w K - 0 1', 3, 4686, 'castling-3'],
  ['4k3/8/8/8/8/8/R7/R3K2R w - - 0 1', 3, 4522, 'castling-4'],
  ['r3k2r/r7/8/8/8/8/8/4K3 b kq - 0 1', 3, 4893, 'castling-5'],
  ['r3k2r/r7/8/8/8/8/8/4K3 b q - 0 1', 3, 4729, 'castling-6'],
  ['r3k2r/r7/8/8/8/8/8/4K3 b k - 0 1', 3, 4686, 'castling-7'],
  ['r3k2r/r7/8/8/8/8/8/4K3 b - - 0 1', 3, 4522, 'castling-8'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 0, 1, 'cpw-pos1-0'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1, 20, 'cpw-pos1-1'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 8902, 'cpw-pos1-3'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281, 'cpw-pos1-4'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 5, 4865609, 'cpw-pos1-5'],
  ['rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R w KQkq - 0 1', 1, 42, 'cpw-pos5-1'],
  ['rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R w KQkq - 0 1', 2, 1352, 'cpw-pos5-2'],
  ['rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R w KQkq - 0 1', 3, 53392, 'cpw-pos5-3'],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 1, 48, 'cpw-pos2-1'],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039, 'cpw-pos2-2'],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862, 'cpw-pos2-3'],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624, 'cpw-pos3-5'],
  ['n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', 1, 24, 'prom-1'],
  ['8/5bk1/8/2Pp4/8/1K6/8/8 w - d6 0 1', 6, 824064, 'ccc-1'],
  ['8/8/1k6/8/2pP4/8/5BK1/8 b - d3 0 1', 6, 824064, 'ccc-2'],
  ['8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1', 6, 1440467, 'ccc-3'],
  ['8/5k2/8/2Pp4/2B5/1K6/8/8 w - d6 0 1', 6, 1440467, 'ccc-4'],
  ['5k2/8/8/8/8/8/8/4K2R w K - 0 1', 6, 661072, 'ccc-5'],
  ['4k2r/8/8/8/8/8/8/5K2 b k - 0 1', 6, 661072, 'ccc-6'],
  ['3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', 6, 803711, 'ccc-7'],
  ['r3k3/8/8/8/8/8/8/3K4 b q - 0 1', 6, 803711, 'ccc-8'],
  ['r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1', 4, 1274206, 'ccc-9'],
  ['r3k2r/7b/8/8/8/8/1B4BQ/R3K2R b KQkq - 0 1', 4, 1274206, 'ccc-10'],
  ['r3k2r/8/3Q4/8/8/5q2/8/R3K2R b KQkq - 0 1', 4, 1720476, 'ccc-11'],
  ['r3k2r/8/5Q2/8/8/3q4/8/R3K2R w KQkq - 0 1', 4, 1720476, 'ccc-12'],
  ['2K2r2/4P3/8/8/8/8/8/3k4 w - - 0 1', 6, 3821001, 'ccc-13'],
  ['3K4/8/8/8/8/8/4p3/2k2R2 b - - 0 1', 6, 3821001, 'ccc-14'],
  ['8/8/1P2K3/8/2n5/1q6/8/5k2 b - - 0 1', 5, 1004658, 'ccc-15'],
  ['8/3K4/2p5/p2b2r1/5k2/8/8/1q6 b - - 0 1', 7, 493407574, 'jvm-4'],
  ['5K2/8/1Q6/2N5/8/1p2k3/8/8 w - - 0 1', 5, 1004658, 'ccc-16'],
  ['4k3/1P6/8/8/8/8/K7/8 w - - 0 1', 6, 217342, 'ccc-17'],
  ['8/k7/8/8/8/8/1p6/4K3 b - - 0 1', 6, 217342, 'ccc-18'],
  ['8/P1k5/K7/8/8/8/8/8 w - - 0 1', 6, 92683, 'ccc-19'],
  ['8/8/8/8/8/k7/p1K5/8 b - - 0 1', 6, 92683, 'ccc-20'],
  ['K1k5/8/P7/8/8/8/8/8 w - - 0 1', 6, 2217, 'ccc-21'],
  ['8/8/8/8/8/p7/8/k1K5 b - - 0 1', 6, 2217, 'ccc-22'],
  ['8/k1P5/8/1K6/8/8/8/8 w - - 0 1', 7, 567584, 'ccc-23'],
  ['8/8/8/8/1k6/8/K1p5/8 b - - 0 1', 7, 567584, 'ccc-24'],
  ['8/8/2k5/5q2/5n2/8/5K2/8 b - - 0 1', 4, 23527, 'ccc-25'],
  ['8/5k2/8/5N2/5Q2/2K5/8/8 w - - 0 1', 4, 23527, 'ccc-26'],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 6, 119060324, 'cpw-pos1-6'],
  ['8/p7/8/1P6/K1k3p1/6P1/7P/8 w - - 0 1', 8, 8103790, 'jvm-7'],
  ['n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', 6, 71179139, 'jvm-8'],
  ['r3k2r/p6p/8/B7/1pp1p3/3b4/P6P/R3K2R w KQkq - 0 1', 6, 77054993, 'jvm-9'],
  ['8/5p2/8/2k3P1/p3K3/8/1P6/8 b - - 0 1', 8, 64451405, 'jvm-11'],
  ['r3k2r/pb3p2/5npp/n2p4/1p1PPB2/6P1/P2N1PBP/R3K2R w KQkq - 0 1', 5, 29179893, 'jvm-12'],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 7, 178633661, 'jvm-10'],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 5, 193690690, 'jvm-6'],
  ['8/2pkp3/8/RP3P1Q/6B1/8/2PPP3/rb1K1n1r w - - 0 1', 6, 181153194, 'ob1'],
  ['rnbqkb1r/ppppp1pp/7n/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 1', 6, 244063299, 'jvm-5'],
  ['8/2ppp3/8/RP1k1P1Q/8/8/2PPP3/rb1K1n1r w - - 0 1', 6, 205552081, 'ob2'],
  ['8/8/3q4/4r3/1b3n2/8/3PPP2/2k1K2R w K - 0 1', 6, 207139531, 'ob3'],
  ['4r2r/RP1kP1P1/3P1P2/8/8/3ppp2/1p4p1/4K2R b K - 0 1', 6, 314516438, 'ob4'],
  ['r3k2r/8/8/8/3pPp2/8/8/R3K1RR b KQkq e3 0 1', 6, 485647607, 'jvm-1'],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 6, 706045033, 'jvm-2'],
  ['r6r/1P4P1/2kPPP2/8/8/3ppp2/1p4p1/R3K2R w KQ - 0 1', 6, 975944981, 'ob5']
];

function perftTests() {

  let passed = 0;
  let failed = 0;
  let totalNodes = 0;

  const t1 = now();

  for (let i = 0; i < PERFT_POSITIONS.length; i++) {
    const p = PERFT_POSITIONS[i];
    const fen = p[0];
    const depth = p[1];
    const expected = p[2];
    const id = p[3];

    position(fen);

    let res = '';
    const result = perft(depth, 0);
    totalNodes += result;

    if (result === expected) {
      passed++;
      res = '';
    }
    else {
      failed++;
      res = '**********';
    }
    uciWrite(`${i + 1} ${id} ${fen} ${depth} ${result} ${expected} ${result-expected} ${res}`);
  }

  const elapsed = now() - t1;
  const nps = Math.round(totalNodes / (elapsed / 1000));

  uciWrite(`passed ${passed} failed ${failed} nodes ${totalNodes.toLocaleString()}  elapsed ${(elapsed / 1000).toFixed(2)}s nps ${nps.toLocaleString()}`);
}

const BENCH_POSITIONS = [
  "r3k2r/2pb1ppp/2pp1q2/p7/1nP1B3/1P2P3/P2N1PPP/R2QK2R w KQkq a6 0 14",
  "4rrk1/2p1b1p1/p1p3q1/4p3/2P2n1p/1P1NR2P/PB3PP1/3R1QK1 b - - 2 24",
  "r3qbrk/6p1/2b2pPp/p3pP1Q/PpPpP2P/3P1B2/2PB3K/R5R1 w - - 16 42",
  "6k1/1R3p2/6p1/2Bp3p/3P2q1/P7/1P2rQ1K/5R2 b - - 4 44",
  "8/8/1p2k1p1/3p3p/1p1P1P1P/1P2PK2/8/8 w - - 3 54",
  "7r/2p3k1/1p1p1qp1/1P1Bp3/p1P2r1P/P7/4R3/Q4RK1 w - - 0 36",
  "r1bq1rk1/pp2b1pp/n1pp1n2/3P1p2/2P1p3/2N1P2N/PP2BPPP/R1BQ1RK1 b - - 2 10",
  "3r3k/2r4p/1p1b3q/p4P2/P2Pp3/1B2P3/3BQ1RP/6K1 w - - 3 87",
  "2r4r/1p4k1/1Pnp4/3Qb1pq/8/4BpPp/5P2/2RR1BK1 w - - 0 42",
  "4q1bk/6b1/7p/p1p4p/PNPpP2P/KN4P1/3Q4/4R3 b - - 0 37",
  "2q3r1/1r2pk2/pp3pp1/2pP3p/P1Pb1BbP/1P4Q1/R3NPP1/4R1K1 w - - 2 34",
  "1r2r2k/1b4q1/pp5p/2pPp1p1/P3Pn2/1P1B1Q1P/2R3P1/4BR1K b - - 1 37",
  "r3kbbr/pp1n1p1P/3ppnp1/q5N1/1P1pP3/P1N1B3/2P1QP2/R3KB1R b KQkq b3 0 17",
  "8/6pk/2b1Rp2/3r4/1R1B2PP/P5K1/8/2r5 b - - 16 42",
  "1r4k1/4ppb1/2n1b1qp/pB4p1/1n1BP1P1/7P/2PNQPK1/3RN3 w - - 8 29",
  "8/p2B4/PkP5/4p1pK/4Pb1p/5P2/8/8 w - - 29 68",
  "3r4/ppq1ppkp/4bnp1/2pN4/2P1P3/1P4P1/PQ3PBP/R4K2 b - - 2 20",
  "5rr1/4n2k/4q2P/P1P2n2/3B1p2/4pP2/2N1P3/1RR1K2Q w - - 1 49",
  "1r5k/2pq2p1/3p3p/p1pP4/4QP2/PP1R3P/6PK/8 w - - 1 51",
  "q5k1/5ppp/1r3bn1/1B6/P1N2P2/BQ2P1P1/5K1P/8 b - - 2 34",
  "r1b2k1r/5n2/p4q2/1ppn1Pp1/3pp1p1/NP2P3/P1PPBK2/1RQN2R1 w - - 0 22",
  "r1bqk2r/pppp1ppp/5n2/4b3/4P3/P1N5/1PP2PPP/R1BQKB1R w KQkq - 0 5",
  "r1bqr1k1/pp1p1ppp/2p5/8/3N1Q2/P2BB3/1PP2PPP/R3K2n b Q - 1 12",
  "r1bq2k1/p4r1p/1pp2pp1/3p4/1P1B3Q/P2B1N2/2P3PP/4R1K1 b - - 2 19",
  "r4qk1/6r1/1p4p1/2ppBbN1/1p5Q/P7/2P3PP/5RK1 w - - 2 25",
  "r7/6k1/1p6/2pp1p2/7Q/8/p1P2K1P/8 w - - 0 32",
  "r3k2r/ppp1pp1p/2nqb1pn/3p4/4P3/2PP4/PP1NBPPP/R2QK1NR w KQkq - 1 5",
  "3r1rk1/1pp1pn1p/p1n1q1p1/3p4/Q3P3/2P5/PP1NBPPP/4RRK1 w - - 0 12",
  "5rk1/1pp1pn1p/p3Brp1/8/1n6/5N2/PP3PPP/2R2RK1 w - - 2 20",
  "8/1p2pk1p/p1p1r1p1/3n4/8/5R2/PP3PPP/4R1K1 b - - 3 27",
  "8/4pk2/1p1r2p1/p1p4p/Pn5P/3R4/1P3PP1/4RK2 w - - 1 33",
  "8/5k2/1pnrp1p1/p1p4p/P6P/4R1PK/1P3P2/4R3 b - - 1 38",
  "8/8/1p1kp1p1/p1pr1n1p/P6P/1R4P1/1P3PK1/1R6 b - - 15 45",
  "8/8/1p1k2p1/p1prp2p/P2n3P/6P1/1P1R1PK1/4R3 b - - 5 49",
  "8/8/1p4p1/p1p2k1p/P2npP1P/4K1P1/1P6/3R4 w - - 6 54",
  "8/8/1p4p1/p1p2k1p/P2n1P1P/4K1P1/1P6/6R1 b - - 6 59",
  "8/5k2/1p4p1/p1pK3p/P2n1P1P/6P1/1P6/4R3 b - - 14 63",
  "8/1R6/1p1K1kp1/p6p/P1p2P1P/6P1/1Pn5/8 w - - 0 67",
  "1rb1rn1k/p3q1bp/2p3p1/2p1p3/2P1P2N/PP1RQNP1/1B3P2/4R1K1 b - - 4 23",
  "4rrk1/pp1n1pp1/q5p1/P1pP4/2n3P1/7P/1P3PB1/R1BQ1RK1 w - - 3 22",
  "r2qr1k1/pb1nbppp/1pn1p3/2ppP3/3P4/2PB1NN1/PP3PPP/R1BQR1K1 w - - 4 12",
  "2r2k2/8/4P1R1/1p6/8/P4K1N/7b/2B5 b - - 0 55",
  "6k1/5pp1/8/2bKP2P/2P5/p4PNb/B7/8 b - - 1 44",
  "2rqr1k1/1p3p1p/p2p2p1/P1nPb3/2B1P3/5P2/1PQ2NPP/R1R4K w - - 3 25",
  "r1b2rk1/p1q1ppbp/6p1/2Q5/8/4BP2/PPP3PP/2KR1B1R b - - 2 14",
  "6r1/5k2/p1b1r2p/1pB1p1p1/1Pp3PP/2P1R1K1/2P2P2/3R4 w - - 1 36",
  "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2",
  "2rr2k1/1p4bp/p1q1p1p1/4Pp1n/2PB4/1PN3P1/P3Q2P/2RR2K1 w - f6 0 20",
  "3br1k1/p1pn3p/1p3n2/5pNq/2P1p3/1PN3PP/P2Q1PB1/4R1K1 w - - 0 23",
  "2r2b2/5p2/5k2/p1r1pP2/P2pB3/1P3P2/K1P3R1/7R w - - 23 93"
];

function bench() {

  newGame();

  const DEPTH = 10;

  let totalNodes = 0;
  const t1 = now();

  for (let i = 0; i < BENCH_POSITIONS.length; i++) {
    const fen = BENCH_POSITIONS[i];
    position(fen);
    tcClear();
    const score = search(DEPTH, 0, -Infinity, Infinity);
    totalNodes += timeControl.nodes;
    uciWrite(`${i + 1} ${fen} score ${score} nodes ${timeControl.nodes}`);
  }

  const elapsed = now() - t1;
  const nps = Math.round(totalNodes / (elapsed / 1000));

  uciWrite(`elapsed ${(elapsed / 1000).toFixed(2)}s nodes ${totalNodes.toLocaleString()} nps ${nps.toLocaleString()}`);
}

function evalTests() {

  for (let i = 0; i < BENCH_POSITIONS.length; i++) {
    const fen = BENCH_POSITIONS[i];
    position(fen);
    const score = evaluate(nodes[0]);
    uciWrite(`${i + 1} fen ${fen} eval ${score}`);
  }

}

function execString (cmd) {
  const tokens = cmd.trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length > 0) {
    execTokens(tokens);
  }
}

//
// uci https://www.chessprogramming.org/UCI https://backscattering.de/chess/uci/
//

function execTokens(tokens) {
  switch (tokens[0].toLowerCase()) {

    case 'ucinewgame':
    case 'u':
      newGame();
      break;

    case 'stop':
      break;

    case 'uci':
      uciWrite('id name Naddu 1');
      uciWrite('id author Colin Jenkins and Claude');
      uciWrite('option name Hash type spin default ' + TT_DEFAULT_MB + ' min ' + TT_MIN_MB + ' max ' + TT_MAX_MB);
      uciWrite('uciok');
      break;

    case 'setoption': { // setoption name Hash value 64
      const name = tokens.indexOf('name');
      const value = tokens.indexOf('value');
      if (name >= 0 && value > name && tokens[name + 1].toLowerCase() === 'hash')
        ttInit(parseInt(tokens[value + 1]));
      break;
    }

    case 'go':
    case 'g':
      if (!positionSet) { // not uci but users do it
        newGame();
        position(STARTPOS);
      }
      tcInit(tokens);
      go();
      break;

    case 'isready':
      uciWrite('readyok');
      break;

    case 'position':
    case 'p': {
      let fen;
      let movesIndex = -1;

      if (tokens[1] === 'startpos' || tokens[1] === 's') {
        fen = STARTPOS;
        movesIndex = 2;
      }
      else if (tokens[1] === 'fen' || tokens[1] === 'f') {
        // FEN takes next 6 tokens, then check for 'moves'
        const fenParts = tokens.slice(2, 8);
        fen = fenParts.join(' ');
        movesIndex = 8;
      }

      // Look for 'moves' keyword and extract moves
      let moves = [];
      if (movesIndex >= 0 && tokens[movesIndex] === 'moves') {
        moves = tokens.slice(movesIndex + 1);
      }

      position(fen, moves);
      break;
    }

    case 'board':
    case 'b':
      printBoard();
      break;

    case 'moves':
    case 'l':
      printMoves();
      break;

    case 'perft':
    case 'f': {
        const depth = parseInt(tokens[1]);
        const t1 = now();
        const n = perft(depth, 0);
        let elapsed = now() - t1;
        const nps = (n/elapsed * 1000) | 0;
        elapsed |= elapsed;
        uciWrite(`nodes ${n} elapsed ${elapsed} nps ${nps}`);
        break;
      }

    case 'eval':
    case 'e':
      if (tokens.length > 1 && (tokens[1].toLowerCase() === 'verbose' || tokens[1].toLowerCase() === 'v'))
        evalVerbose(nodes[0]);
      else
        uciWrite(evaluate(nodes[0]));
      break;

    case 'pst':
      pstCommand(tokens);
      break;

    case 'feature':
      featureCommand(tokens);
      break;

    case 'search':
      searchCommand(tokens);
      break;

    case 'perfttests':
    case 'pt':
      perftTests();
      break;

    case 'bench':
    case 'h':
      bench();
      break;

    case 'evaltests':
    case 'et':
      evalTests();
      break;

    case 'quit':
    case 'q':
      uciQuit();
      break;

    case '?':
    case 'help':
      uciWrite('uci                         show engine name and author');
      uciWrite('isready                     replies readyok');
      uciWrite('setoption name Hash value <mb>   set the hash table size, default 16, 1 to 1024');
      uciWrite('ucinewgame (u)              clear the hash and history, do this before a new game');
      uciWrite('position (p) startpos       set up the start position, optionally followed by moves e2e4 e7e5 ...');
      uciWrite('position (p) fen <fen>      set up a position from a fen string, optionally followed by moves');
      uciWrite('go (g)                      think for 100ms and reply with the best move');
      uciWrite('go (g) depth (d) <n>        search to a fixed depth');
      uciWrite('go (g) movetime (m) <ms>    search for a fixed number of milliseconds');
      uciWrite('go (g) nodes (n) <n>        search a fixed number of nodes');
      uciWrite('go (g) wtime <ms> btime <ms> winc <ms> binc <ms> [movestogo <n>]');
      uciWrite('                            search using the game clock');
      uciWrite('board (b)                   show the current position');
      uciWrite('moves (l)                   list the legal moves, or checkmate/stalemate if there are none');
      uciWrite('eval (e)                    show the static eval of the current position');
      uciWrite('eval (e) verbose (v)        show the eval itemised by term, from the white side');
      uciWrite('pst                         show the piece square tables, wn mg etc, a1 to h8');
      uciWrite('pst <piece> [mg|eg] [def|<sq>|<sq> <v>|<64 v>]  print, reset or set a table, see the readme');
      uciWrite('feature [<name> [def|<values>]]  print, reset or set the eval features, see the readme');
      uciWrite('search [<name> [def|<values>]]   print, reset or set the search parameters, see the readme');
      uciWrite('perft (f) <depth>           count leaf nodes to the given depth');
      uciWrite('bench (h)                   search 50 positions and report nodes and nps');
      uciWrite('evaltests (et)              show the eval of the bench positions');
      uciWrite('perfttests (pt)             run the perft test suite (takes a while)');
      uciWrite('quit (q)                    exit');
      uciWrite('? or help                   show this');
      break;

    default:
      uciWrite('? for help');

  }
}

const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;

function uciWrite(data) {
  if (IS_NODE)
    process.stdout.write(data + '\n');
  else
    postMessage(String(data));
}

// in Node close readline and let the process exit on its own, process.exit()
// deadlocks in Node's shutdown now and then (1 in 5 on Node 24 under WSL2)
let rl = null;

function uciQuit() {
  if (IS_NODE)
    rl.close();
  else
    close();
}

nodeInitOnce();
distInitOnce();
evalInitOnce();
zobInitOnce();
ttInit(TT_DEFAULT_MB);
historyInitOnce();
// the live eval and search values from their defaults, which live in one place each so that
// tooling/apply.js can write tuned values there
featureCommand(['feature', 'def']);
searchCommand(['search', 'def']);

if (IS_NODE) {

  // a closed pipe (naddu.js bench | head) is not an error worth a stack trace
  process.stdout.on('error', function() {});

  const readline = require('readline');
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', function(line) {
    execString(line);
  });

  // If command-line arguments provided, execute them and exit
  if (process.argv.length > 2) {
    const commands = process.argv.slice(2);
    for (const cmd of commands) {
      execString(cmd);
    }
    uciQuit();
  }
}
else {

  // Web Worker: each posted message is a UCI command string, output is posted back as text.
  onmessage = function(e) {
    execString(String(e.data));
  };
}
