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
const TT_SIZE = 1 << 20;
const TT_MASK = TT_SIZE - 1;

const ttHashLo = new Uint32Array(TT_SIZE);
const ttHashHi = new Uint32Array(TT_SIZE);
const ttMove = new Uint32Array(TT_SIZE);
const ttType = new Uint8Array(TT_SIZE);
const ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Uint8Array(TT_SIZE);

const ttStats = {hits: 0};

function ttInitOnce() {
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

const PHASE = new Int16Array([0, 0, 1, 1, 2, 4, 0]);

const MGW = Array(7);
const MGB = Array(7);
const EGW = Array(7);
const EGB = Array(7);

const counts = new Uint8Array(16);

//
// evaluate() uses PESTO values https://chessprogramming.org/PeSTO%27s_Evaluation_Function
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

  const mgScore = pos.stm ? mgB - mgW : mgW - mgB;
  const egScore = pos.stm ? egB - egW : egW - egB;

  if (phase > 24)
    phase = 24;

  const e = Math.trunc((mgScore * phase + egScore * (24 - phase)) / 24);

  return e;
}

function evalInitOnce() {

  const MAT_MG = new Int16Array([0, 82, 337, 365, 477, 1025, 0]);
  const MAT_EG = new Int16Array([0, 94, 281, 297, 512,  936, 0]);

  const PAWN_MG = new Int16Array([
      0,   0,   0,   0,   0,   0,   0,   0,   0, 0, 0, 0, 0, 0, 0, 0,
    -35,  -1, -20, -23, -15,  24,  38, -22,   0, 0, 0, 0, 0, 0, 0, 0,
    -26,  -4,  -4, -10,   3,   3,  33, -12,   0, 0, 0, 0, 0, 0, 0, 0,
    -27,  -2,  -5,  12,  17,   6,  10, -25,   0, 0, 0, 0, 0, 0, 0, 0,
    -14,  13,   6,  21,  23,  12,  17, -23,   0, 0, 0, 0, 0, 0, 0, 0,
     -6,   7,  26,  31,  65,  56,  25, -20,   0, 0, 0, 0, 0, 0, 0, 0,
     98, 134,  61,  95,  68, 126,  34, -11,   0, 0, 0, 0, 0, 0, 0, 0,
      0,   0,   0,   0,   0,   0,   0,   0,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const PAWN_EG = new Int16Array([
      0,   0,   0,   0,   0,   0,   0,   0,   0, 0, 0, 0, 0, 0, 0, 0,
     13,   8,   8,  10,  13,   0,   2,  -7,   0, 0, 0, 0, 0, 0, 0, 0,
      4,   7,  -6,   1,   0,  -5,  -1,  -8,   0, 0, 0, 0, 0, 0, 0, 0,
     13,   9,  -3,  -7,  -7,  -8,   3,  -1,   0, 0, 0, 0, 0, 0, 0, 0,
     32,  24,  13,   5,  -2,   4,  17,  17,   0, 0, 0, 0, 0, 0, 0, 0,
     94, 100,  85,  67,  56,  53,  82,  84,   0, 0, 0, 0, 0, 0, 0, 0,
    178, 173, 158, 134, 147, 132, 165, 187,   0, 0, 0, 0, 0, 0, 0, 0,
      0,   0,   0,   0,   0,   0,   0,   0,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const KNIGHT_MG = new Int16Array([
   -105, -21, -58, -33, -17, -28, -19, -23,   0, 0, 0, 0, 0, 0, 0, 0,
    -29, -53, -12,  -3,  -1,  18, -14, -19,   0, 0, 0, 0, 0, 0, 0, 0,
    -23,  -9,  12,  10,  19,  17,  25, -16,   0, 0, 0, 0, 0, 0, 0, 0,
    -13,   4,  16,  13,  28,  19,  21,  -8,   0, 0, 0, 0, 0, 0, 0, 0,
     -9,  17,  19,  53,  37,  69,  18,  22,   0, 0, 0, 0, 0, 0, 0, 0,
    -47,  60,  37,  65,  84, 129,  73,  44,   0, 0, 0, 0, 0, 0, 0, 0,
    -73, -41,  72,  36,  23,  62,   7, -17,   0, 0, 0, 0, 0, 0, 0, 0,
   -167, -89, -34, -49,  61, -97, -15,-107,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const KNIGHT_EG = new Int16Array([
    -29, -51, -23, -15, -22, -18, -50, -64,   0, 0, 0, 0, 0, 0, 0, 0,
    -42, -20, -10,  -5,  -2, -20, -23, -44,   0, 0, 0, 0, 0, 0, 0, 0,
    -23,  -3,  -1,  15,  10,  -3, -20, -22,   0, 0, 0, 0, 0, 0, 0, 0,
    -18,  -6,  16,  25,  16,  17,   4, -18,   0, 0, 0, 0, 0, 0, 0, 0,
    -17,   3,  22,  22,  22,  11,   8, -18,   0, 0, 0, 0, 0, 0, 0, 0,
    -24, -20,  10,   9,  -1,  -9, -19, -41,   0, 0, 0, 0, 0, 0, 0, 0,
    -25,  -8, -25,  -2,  -9, -25, -24, -52,   0, 0, 0, 0, 0, 0, 0, 0,
    -58, -38, -13, -28, -31, -27, -63, -99,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const BISHOP_MG = new Int16Array([
    -33,  -3, -14, -21, -13, -12, -39, -21,   0, 0, 0, 0, 0, 0, 0, 0,
      4,  15,  16,   0,   7,  21,  33,   1,   0, 0, 0, 0, 0, 0, 0, 0,
      0,  15,  15,  15,  14,  27,  18,  10,   0, 0, 0, 0, 0, 0, 0, 0,
     -6,  13,  13,  26,  34,  12,  10,   4,   0, 0, 0, 0, 0, 0, 0, 0,
     -4,   5,  19,  50,  37,  37,   7,  -2,   0, 0, 0, 0, 0, 0, 0, 0,
    -16,  37,  43,  40,  35,  50,  37,  -2,   0, 0, 0, 0, 0, 0, 0, 0,
    -26,  16, -18, -13,  30,  59,  18, -47,   0, 0, 0, 0, 0, 0, 0, 0,
    -29,   4, -82, -37, -25, -42,   7,  -8,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const BISHOP_EG = new Int16Array([
    -23,  -9, -23,  -5,  -9, -16,  -5, -17,   0, 0, 0, 0, 0, 0, 0, 0,
    -14, -18,  -7,  -1,   4,  -9, -15, -27,   0, 0, 0, 0, 0, 0, 0, 0,
    -12,  -3,   8,  10,  13,   3,  -7, -15,   0, 0, 0, 0, 0, 0, 0, 0,
     -6,   3,  13,  19,   7,  10,  -3,  -9,   0, 0, 0, 0, 0, 0, 0, 0,
     -3,   9,  12,   9,  14,  10,   3,   2,   0, 0, 0, 0, 0, 0, 0, 0,
      2,  -8,   0,  -1,  -2,   6,   0,   4,   0, 0, 0, 0, 0, 0, 0, 0,
     -8,  -4,   7, -12,  -3, -13,  -4, -14,   0, 0, 0, 0, 0, 0, 0, 0,
    -14, -21, -11,  -8,  -7,  -9, -17, -24,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const ROOK_MG = new Int16Array([
    -19, -13,   1,  17,  16,   7, -37, -26,   0, 0, 0, 0, 0, 0, 0, 0,
    -44, -16, -20,  -9,  -1,  11,  -6, -71,   0, 0, 0, 0, 0, 0, 0, 0,
    -45, -25, -16, -17,   3,   0,  -5, -33,   0, 0, 0, 0, 0, 0, 0, 0,
    -36, -26, -12,  -1,   9,  -7,   6, -23,   0, 0, 0, 0, 0, 0, 0, 0,
    -24, -11,   7,  26,  24,  35,  -8, -20,   0, 0, 0, 0, 0, 0, 0, 0,
     -5,  19,  26,  36,  17,  45,  61,  16,   0, 0, 0, 0, 0, 0, 0, 0,
     27,  32,  58,  62,  80,  67,  26,  44,   0, 0, 0, 0, 0, 0, 0, 0,
     32,  42,  32,  51,  63,   9,  31,  43,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const ROOK_EG = new Int16Array([
     -9,   2,   3,  -1,  -5, -13,   4, -20,   0, 0, 0, 0, 0, 0, 0, 0,
     -6,  -6,   0,   2,  -9,  -9, -11,  -3,   0, 0, 0, 0, 0, 0, 0, 0,
     -4,   0,  -5,  -1,  -7, -12,  -8, -16,   0, 0, 0, 0, 0, 0, 0, 0,
      3,   5,   8,   4,  -5,  -6,  -8, -11,   0, 0, 0, 0, 0, 0, 0, 0,
      4,   3,  13,   1,   2,   1,  -1,   2,   0, 0, 0, 0, 0, 0, 0, 0,
      7,   7,   7,   5,   4,  -3,  -5,  -3,   0, 0, 0, 0, 0, 0, 0, 0,
     11,  13,  13,  11,  -3,   3,   8,   3,   0, 0, 0, 0, 0, 0, 0, 0,
     13,  10,  18,  15,  12,  12,   8,   5,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const QUEEN_MG = new Int16Array([
     -1, -18,  -9,  10, -15, -25, -31, -50,   0, 0, 0, 0, 0, 0, 0, 0,
    -35,  -8,  11,   2,   8,  15,  -3,   1,   0, 0, 0, 0, 0, 0, 0, 0,
    -14,   2, -11,  -2,  -5,   2,  14,   5,   0, 0, 0, 0, 0, 0, 0, 0,
     -9, -26,  -9, -10,  -2,  -4,   3,  -3,   0, 0, 0, 0, 0, 0, 0, 0,
    -27, -27, -16, -16,  -1,  17,  -2,   1,   0, 0, 0, 0, 0, 0, 0, 0,
    -13, -17,   7,   8,  29,  56,  47,  57,   0, 0, 0, 0, 0, 0, 0, 0,
    -24, -39,  -5,   1, -16,  57,  28,  54,   0, 0, 0, 0, 0, 0, 0, 0,
    -28,   0,  29,  12,  59,  44,  43,  45,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const QUEEN_EG = new Int16Array([
    -33, -28, -22, -43,  -5, -32, -20, -41,   0, 0, 0, 0, 0, 0, 0, 0,
    -22, -23, -30, -16, -16, -23, -36, -32,   0, 0, 0, 0, 0, 0, 0, 0,
    -16, -27,  15,   6,   9,  17,  10,   5,   0, 0, 0, 0, 0, 0, 0, 0,
    -18,  28,  19,  47,  31,  34,  39,  23,   0, 0, 0, 0, 0, 0, 0, 0,
      3,  22,  24,  45,  57,  40,  57,  36,   0, 0, 0, 0, 0, 0, 0, 0,
    -20,   6,   9,  49,  47,  35,  19,   9,   0, 0, 0, 0, 0, 0, 0, 0,
    -17,  20,  32,  41,  58,  25,  30,   0,   0, 0, 0, 0, 0, 0, 0, 0,
     -9,  22,  22,  27,  27,  19,  10,  20,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const KING_MG = new Int16Array([
    -15,  36,  12, -54,   8, -28,  24,  14,   0, 0, 0, 0, 0, 0, 0, 0,
      1,   7,  -8, -64, -43, -16,   9,   8,   0, 0, 0, 0, 0, 0, 0, 0,
    -14, -14, -22, -46, -44, -30, -15, -27,   0, 0, 0, 0, 0, 0, 0, 0,
    -49,  -1, -27, -39, -46, -44, -33, -51,   0, 0, 0, 0, 0, 0, 0, 0,
    -17, -20, -12, -27, -30, -25, -14, -36,   0, 0, 0, 0, 0, 0, 0, 0,
     -9,  24,   2, -16, -20,   6,  22, -22,   0, 0, 0, 0, 0, 0, 0, 0,
     29,  -1, -20,  -7,  -8,  -4, -38, -29,   0, 0, 0, 0, 0, 0, 0, 0,
    -65,  23,  16, -15, -56, -34,   2,  13,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const KING_EG = new Int16Array([
    -53, -34, -21, -11, -28, -14, -24, -43,   0, 0, 0, 0, 0, 0, 0, 0,
    -27, -11,   4,  13,  14,   4,  -5, -17,   0, 0, 0, 0, 0, 0, 0, 0,
    -19,  -3,  11,  21,  23,  16,   7,  -9,   0, 0, 0, 0, 0, 0, 0, 0,
    -18,  -4,  21,  24,  27,  23,   9, -11,   0, 0, 0, 0, 0, 0, 0, 0,
     -8,  22,  24,  27,  26,  33,  26,   3,   0, 0, 0, 0, 0, 0, 0, 0,
     10,  17,  23,  15,  20,  45,  44,  13,   0, 0, 0, 0, 0, 0, 0, 0,
    -12,  17,  14,  17,  17,  38,  23,  11,   0, 0, 0, 0, 0, 0, 0, 0,
    -74, -35, -18, -18, -11,  15,   4, -17,   0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const PST_MG = [PAWN_MG, PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
  const PST_EG = [PAWN_EG, PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

  for (let piece = 1; piece <= 6; piece++) {
    MGW[piece] = new Int16Array(128);
    MGB[piece] = new Int16Array(128);
    EGW[piece] = new Int16Array(128);
    EGB[piece] = new Int16Array(128);
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88)
        continue;
      const flipped = sq ^ 0x70;
      MGW[piece][sq] = MAT_MG[piece] + PST_MG[piece][sq];
      MGB[piece][sq] = MAT_MG[piece] + PST_MG[piece][flipped];
      EGW[piece][sq] = MAT_EG[piece] + PST_EG[piece][sq];
      EGB[piece][sq] = MAT_EG[piece] + PST_EG[piece][flipped];
    }
  }
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
  let movestogo = 30; // Default to 30 moves if not specified
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
        movestogo = Math.max(2,parseInt(tokens[++i]) || 30);
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

    // Time allocation: timeLeft / movestogo + increment / 2
    // The soft limit stops new iterations, the hard limit aborts the search
    const allocatedTime = (timeLeft / movestogo) + (increment / 2);
    tc.softTime = tc.startTime + allocatedTime / 2;
    tc.finishTime = tc.startTime + Math.min(allocatedTime * 3, timeLeft / 2);
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
  if (!isPV && !inCheck && depth <=  8 && beta < TT_MATE_BOUND && (ev - depth * 100) >= beta)
    return ev;

  // null move pruning https://www.chessprogramming.org/Null_Move_Pruning
  // counts[] is still valid from evaluate() above
  if (!isPV && !inCheck && !node.noNull && depth >= 2 && ev >= beta && beta < TT_MATE_BOUND
      && (counts[KNIGHT | pos.stm] + counts[BISHOP | pos.stm] + counts[ROOK | pos.stm] + counts[QUEEN | pos.stm]) > 0) {
    posSet(nextPos, pos);
    makeNull(nextPos);
    nextNode.noNull = 1;
    const score = -search(depth - 1 - 2 - (depth >> 2), ply + 1, -beta, -beta + 1);
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

    let score;

    if (numMoves === 1) {
      score = -search(depth - 1, ply + 1, -beta, -alpha);
    }
    else {
      // late move reductions https://www.chessprogramming.org/Late_Move_Reductions
      // late quiet non-killer moves get a reduced null window search first
      let r = 0;
      if (depth >= 3 && numMoves > 3 && !inCheck && move !== node.killer && !(move & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK)))
        r = numMoves > 12 ? 2 : 1;
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
    let delta = 30;
    let alpha = d >= 4 ? score - delta : -Infinity;
    let beta  = d >= 4 ? score + delta :  Infinity;
    while (true) {
      score = search(d, 0, alpha, beta);
      if (tc.finished || (score > alpha && score < beta))
        break;
      delta *= 2;
      alpha = delta > 500 ? -Infinity : score - delta;
      beta  = delta > 500 ?  Infinity : score + delta;
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

  const DEPTH = 6;

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
  switch (tokens[0]) {

    case 'ucinewgame':
    case 'u':
      newGame();
      break;

    case 'stop':
      break;

    case 'uci':
      uciWrite('id name Naddu 1');
      uciWrite('id author Colin Jenkins and Claude');

      uciWrite('uciok');
      break;

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
      uciWrite(evaluate(nodes[0]));
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
      uciWrite('eval (e)                    show the static eval of the current position');
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

function uciQuit() {
  if (IS_NODE)
    process.exit(0);
  else
    close();
}

nodeInitOnce();
evalInitOnce();
zobInitOnce();
ttInitOnce();
historyInitOnce();

if (IS_NODE) {

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', function(line) {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'quit' || cmd === 'q') {
      uciQuit();
    }
    else {
      execString(line);
    }
  });

  // If command-line arguments provided, execute them and exit
  if (process.argv.length > 2) {
    const commands = process.argv.slice(2);
    for (const cmd of commands) {
      execString(cmd);
    }
    process.exit(0);
  }
}
else {

  // Web Worker: each posted message is a UCI command string, output is posted back as text.
  onmessage = function(e) {
    execString(String(e.data));
  };
}
