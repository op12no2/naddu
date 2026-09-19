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
    this.list = new Uint8Array(32);   // piece lists, the squares of white's pieces from 0, black's from 16
    this.count = new Uint8Array(2);   // how many in each, a piece's slot is kept at board[sq | 8], see listAdd
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
  pos.list.fill(0);
  pos.count.fill(0);
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
  pos.list.set(other.list);
  pos.count.set(other.count);
  pos.kings.set(other.kings);
  pos.ep = other.ep;
  pos.rights = other.rights;
  pos.stm = other.stm;
  pos.hashLo = other.hashLo;
  pos.hashHi = other.hashHi;
  pos.hmc = other.hmc;
}

// piece lists https://www.chessprogramming.org/Piece-Lists
// the generators and the eval walk them instead of the board; the slot of the piece on sq is at
// board[sq | 8], the off board twin of sq in 0x88, so it is copied with the board in posSet
function listAdd(pos, sq) {
  const c = pos.board[sq] >> 3;
  const i = pos.count[c]++;
  pos.list[(c << 4) + i] = sq;
  pos.board[sq | 8] = i;
}

function listMove(pos, from, to, c) {
  const i = pos.board[from | 8];
  pos.list[(c << 4) + i] = to;
  pos.board[to | 8] = i;
}

// the last entry of the list takes the slot of the piece on sq
function listRemove(pos, sq, c) {
  const i = pos.board[sq | 8];
  const last = --pos.count[c];
  const lastSq = pos.list[(c << 4) + last];
  pos.list[(c << 4) + i] = lastSq;
  pos.board[lastSq | 8] = i;
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

  for (let sq = 0; sq < 128; sq++) {
    if (!(sq & 0x88) && pos.board[sq])
      listAdd(pos, sq);
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

  killersClear();  // the histories stay for the game, see newGame()

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
    this.killer = 0;
    this.quiets = new Uint32Array(MAX_MOVES);  // the quiet moves tried so far, for history maluses on a cutoff
    this.numQuiets = 0;
    this.piece = 0;  // the piece making the move being searched at this node, for the history lookups
    this.eval = 0;   // the static eval at this node, NO_EVAL in check
    this.noNull = 0; // set on the child of a null move
  this.inCheck = 0; // the side to move is in check here, found by the parent as it made the move (the root tests itself)
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

// xorshift32 for the state, then a non linear mix of the output: xorshift alone is linear over GF(2),
// and with the two halves of each zobrist key taken from consecutive states the second half of every
// hash was a fixed linear function of the first, so the key was 32 bits in effect
function rand32() {
  rand32Seed ^= rand32Seed << 13;
  rand32Seed ^= rand32Seed >>> 17;
  rand32Seed ^= rand32Seed << 5;
  let x = rand32Seed;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
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


// history gravity: a bonus for the quiet move that cut off, a malus for the quiets tried before it, both
// pulled towards zero by the current value so the tables stay within HISTORY_MAX and keep their contrast
// https://www.chessprogramming.org/History_Heuristic
function addHistory(pos, move, bonus) {
  const from = (move >> 8) & 0xff;
  const to = move & 0xff;
  const piece = pos.board[from];
  const current = pieceHistory[piece][to];
  pieceHistory[piece][to] = current + bonus - ((current * Math.abs(bonus)) / HISTORY_MAX | 0);
}

// on a quiet cutoff: bonus for the move, malus for the quiets that came before it
function updateHistories(node, pos, bestMove, depth) {
  const bonus = Math.min(HISTORY[0] * depth * depth, HISTORY[1]);
  addHistory(pos, bestMove, bonus);
  for (let i = 0; i < node.numQuiets; i++) {
    const move = node.quiets[i];
    if (move !== bestMove)
      addHistory(pos, move, -bonus);
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

// pseudo legal moves of the side to move into node.moves, captures only when capturesOnly (the
// quiescence search); legality is the king test after makeMove https://www.chessprogramming.org/Move_Generation
function genMoves(node, capturesOnly) {

  const moves = node.moves;
  const pos = node.pos;
  const board = pos.board;
  const stm = pos.stm;
  const nstm = stm ^ BLACK;
  const list = pos.list;
  const base = stm << 1;  // 0 or 16
  const n = pos.count[stm >> 3];

  let numMoves = 0;

  for (let i = 0; i < n; i++) {
    const sq = list[base + i];
    const type = board[sq] & 7;
    const from = sq << 8;

    if (type === PAWN) {
      const dir = stm === WHITE ? 16 : -16;
      const rank = sq >> 4;
      const isPromo = rank === (stm === WHITE ? 6 : 1);
      // captures, en passant, then the pushes
      for (let k = -1; k <= 1; k += 2) {
        const to = sq + dir + k;
        if (to & 0x88)
          continue;
        const target = board[to];
        if (target && (target & BLACK) === nstm) {
          if (isPromo) {
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE | MOVE_PROMO_Q;
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE | MOVE_PROMO_R;
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE | MOVE_PROMO_B;
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE | MOVE_PROMO_N;
          }
          else
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE;
        }
        else if (pos.ep && to === pos.ep)
          moves[numMoves++] = to | from | MOVE_FLAG_EPCAPTURE | MOVE_FLAG_CAPTURE;
      }
      if (capturesOnly)
        continue;
      const to1 = sq + dir;
      if (!(to1 & 0x88) && !board[to1]) {
        if (isPromo) {
          moves[numMoves++] = to1 | from | MOVE_PROMO_Q;
          moves[numMoves++] = to1 | from | MOVE_PROMO_R;
          moves[numMoves++] = to1 | from | MOVE_PROMO_B;
          moves[numMoves++] = to1 | from | MOVE_PROMO_N;
        }
        else {
          moves[numMoves++] = to1 | from;
          const to2 = to1 + dir;
          if (rank === (stm === WHITE ? 1 : 6) && !board[to2])
            moves[numMoves++] = to2 | from | MOVE_FLAG_EPMAKE;
        }
      }
    }

    else if (type === KNIGHT || type === KING) {
      const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
      const flag = type === KNIGHT ? 0 : MOVE_FLAG_KING;
      for (let k = 0; k < 8; k++) {
        const to = sq + offsets[k];
        if (to & 0x88)
          continue;
        const target = board[to];
        if (target) {
          if ((target & BLACK) === nstm)
            moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE | flag;
        }
        else if (!capturesOnly)
          moves[numMoves++] = to | from | flag;
      }
    }

    else {
      // the sliders: a ray of quiets up to the first piece, a capture if it is an enemy
      const offsets = type === BISHOP ? BISHOP_OFFSETS : type === ROOK ? ROOK_OFFSETS : QUEEN_OFFSETS;
      for (let k = 0; k < offsets.length; k++) {
        const off = offsets[k];
        let to = sq + off;
        while (!(to & 0x88)) {
          const target = board[to];
          if (target) {
            if ((target & BLACK) === nstm)
              moves[numMoves++] = to | from | MOVE_FLAG_CAPTURE;
            break;
          }
          if (!capturesOnly)
            moves[numMoves++] = to | from;
          to += off;
        }
      }
    }
  }

  // castling https://www.chessprogramming.org/Castling
  if (pos.rights && !capturesOnly) {
    if (stm === WHITE) {
      if ((pos.rights & RIGHTS_K) && !board[0x05] && !board[0x06] &&
          !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x05, BLACK) && !isAttacked(pos, 0x06, BLACK))
        moves[numMoves++] = 0x06 | (0x04 << 8) | MOVE_FLAG_KCASTLE;
      if ((pos.rights & RIGHTS_Q) && !board[0x03] && !board[0x02] && !board[0x01] &&
          !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x03, BLACK) && !isAttacked(pos, 0x02, BLACK))
        moves[numMoves++] = 0x02 | (0x04 << 8) | MOVE_FLAG_QCASTLE;
    }
    else {
      if ((pos.rights & RIGHTS_k) && !board[0x75] && !board[0x76] &&
          !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x75, WHITE) && !isAttacked(pos, 0x76, WHITE))
        moves[numMoves++] = 0x76 | (0x74 << 8) | MOVE_FLAG_KCASTLE;
      if ((pos.rights & RIGHTS_q) && !board[0x73] && !board[0x72] && !board[0x71] &&
          !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x73, WHITE) && !isAttacked(pos, 0x72, WHITE))
        moves[numMoves++] = 0x72 | (0x74 << 8) | MOVE_FLAG_QCASTLE;
    }
  }

  node.numMoves = numMoves;
}

//
// move ordering: the hash move, captures by MVV-LVA, the killer, quiets by history, then the captures that
// lose material by see(); ranked in one pass over the generated moves and picked by selection sort
// https://www.chessprogramming.org/Move_Ordering
//

// static exchange evaluation: the material a capture wins after both sides take on the square with their
// least valuable piece each time, on a scratch board so sliders behind a taken piece come into play
// https://www.chessprogramming.org/Static_Exchange_Evaluation
const seeBoard = new Uint8Array(128);
const seeGain = new Int32Array(32);

// the square of the least valuable piece of colour c attacking sq on the scratch board, or -1
function seeAttacker(sq, c) {
  const board = seeBoard;
  const pawnDir = c === WHITE ? -16 : 16;
  const pawn = PAWN | c;
  let p = sq + pawnDir - 1;
  if (p >= 0 && !(p & 0x88) && board[p] === pawn)
    return p;
  p = sq + pawnDir + 1;
  if (p >= 0 && !(p & 0x88) && board[p] === pawn)
    return p;
  const knight = KNIGHT | c;
  for (let i = 0; i < 8; i++) {
    const to = sq + KNIGHT_OFFSETS[i];
    if (!(to & 0x88) && board[to] === knight)
      return to;
  }
  const bishop = BISHOP | c;
  const rook = ROOK | c;
  const queen = QUEEN | c;
  let queenSq = -1;
  for (let i = 0; i < 4; i++) {
    const off = BISHOP_OFFSETS[i];
    let to = sq + off;
    while (to >= 0 && !(to & 0x88)) {
      const piece = board[to];
      if (piece) {
        if (piece === bishop)
          return to;
        if (piece === queen)
          queenSq = to;
        break;
      }
      to += off;
    }
  }
  for (let i = 0; i < 4; i++) {
    const off = ROOK_OFFSETS[i];
    let to = sq + off;
    while (to >= 0 && !(to & 0x88)) {
      const piece = board[to];
      if (piece) {
        if (piece === rook)
          return to;
        if (piece === queen)
          queenSq = to;
        break;
      }
      to += off;
    }
  }
  if (queenSq >= 0)
    return queenSq;
  const king = KING | c;
  for (let i = 0; i < 8; i++) {
    const to = sq + KING_OFFSETS[i];
    if (!(to & 0x88) && board[to] === king)
      return to;
  }
  return -1;
}

function see(pos, move) {
  const from = (move >> 8) & 0xff;
  const to = move & 0xff;
  let victim = (move & MOVE_FLAG_EPCAPTURE) ? PAWN : pos.board[to] & 7;
  let attacker = pos.board[from] & 7;
  if (SEE_VALUE[victim] >= SEE_VALUE[attacker])  // cannot lose the exchange, at worst the attacker goes for the victim, so at least this
    return SEE_VALUE[victim] - SEE_VALUE[attacker];
  const board = seeBoard;
  board.set(pos.board);
  let c = pos.stm;
  if (move & MOVE_FLAG_EPCAPTURE)
    board[c === WHITE ? to - 16 : to + 16] = 0;
  board[from] = 0;
  seeGain[0] = SEE_VALUE[victim];
  let d = 0;
  while (true) {
    d++;
    seeGain[d] = SEE_VALUE[attacker] - seeGain[d - 1];  // what taking back is worth at best
    c ^= BLACK;
    const sq = seeAttacker(to, c);
    if (sq < 0)
      break;
    attacker = board[sq] & 7;
    board[sq] = 0;
  }
  while (--d > 0)
    seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
  return seeGain[0];
}

const RANK_TT = 1 << 30;
const RANK_CAPTURE = 1 << 28;   // plus victim * 16 - attacker https://www.chessprogramming.org/MVV-LVA
const RANK_KILLER = 1 << 27;    // quiets by history sit below it, within +-HISTORY_MAX
const RANK_BAD = -(1 << 28);    // losing captures, plus the same MVV-LVA

// rank every generated move; the hash move is whichever generated move it matches, so a move from a hash
// collision is simply never found. In the quiescence search losing captures are dropped rather than ranked
function rankMoves(node, ttMove, qs) {
  const pos = node.pos;
  const board = pos.board;
  const moves = node.moves;
  const ranks = node.ranks;
  let n = 0;
  for (let i = 0; i < node.numMoves; i++) {
    const move = moves[i];
    const to = move & 0xff;
    const attacker = board[(move >> 8) & 0xff];
    let rank;
    if (move === ttMove)
      rank = RANK_TT;
    else if (move & MOVE_FLAG_CAPTURE) {
      const victim = (move & MOVE_FLAG_EPCAPTURE) ? PAWN : board[to] & 7;
      rank = victim * 16 - (attacker & 7);
      if ((move & MOVE_PROMO_MASK) || see(pos, move) >= 0)
        rank += RANK_CAPTURE;
      else if (qs)
        continue;
      else
        rank += RANK_BAD;
    }
    else if (move & MOVE_PROMO_MASK)
      rank = RANK_CAPTURE + QUEEN * 16;
    else if (move === node.killer)
      rank = RANK_KILLER;
    else
      rank = pieceHistory[attacker][to];
    moves[n] = move;
    ranks[n++] = rank;
  }
  node.numMoves = n;
  node.nextMove = 0;
}

// the best ranked move not yet picked, swapped into place; 0 when they are all picked
function pickBest(node) {
  const moves = node.moves;
  const ranks = node.ranks;
  const idx = node.nextMove;
  if (idx >= node.numMoves)
    return 0;
  let bestIdx = idx;
  let bestRank = ranks[idx];
  for (let i = idx + 1; i < node.numMoves; i++) {
    if (ranks[i] > bestRank) {
      bestRank = ranks[i];
      bestIdx = i;
    }
  }
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

  // the victim leaves its list before the mover takes the square
  if (captured)
    listRemove(pos, to, captured >> 3);
  listMove(pos, from, to, piece >> 3);

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
      listRemove(pos, capSq, capPiece >> 3);
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
      listMove(pos, to + 1, to - 1, rook >> 3);
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
      listMove(pos, to - 2, to + 1, rook >> 3);
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

  genMoves(node, 0);

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

  genMoves(node, 0);

  for (let i = 0; i < node.numMoves; i++) {
    const move = node.moves[i];
    if (formatMove(move) === uciMove) {
      makeMove(move, pos);
      return;
    }
  }
}

// the phase of the start position, from PHASE in the config
let PHASE_TOTAL = 24;

// the tables the eval reads, [piece][square] for each side and phase, material folded in
const MGW = Array(7);
const MGB = Array(7);
const EGW = Array(7);
const EGB = Array(7);

//
// evaluate() is PeSTO's material and piece square tables https://www.chessprogramming.org/PeSTO%27s_Evaluation_Function
// https://www.chessprogramming.org/Piece-Square_Tables
// with a tapered eval https://www.chessprogramming.org/Tapered_Eval
// a check for insufficient material https://www.chessprogramming.org/Draw_Evaluation
// and a mop-up term for pawnless endings https://www.chessprogramming.org/Mop-up_Evaluation
//

// K v K and K v K plus a minor are draws https://www.chessprogramming.org/Draw_Evaluation
function materialDraw(pos) {
  const n = pos.count[0] + pos.count[1];
  if (n === 2)
    return 1;
  if (n === 3) {
    const board = pos.board;
    const list = pos.list;
    const i = pos.count[0] === 2 ? 0 : 16;  // the side with two pieces
    const type = (board[list[i]] & 7) === KING ? board[list[i + 1]] & 7 : board[list[i]] & 7;
    return type === KNIGHT || type === BISHOP ? 1 : 0;
  }
  return 0;
}

// whether a side has a piece other than pawns and the king, for null move
function hasPiece(pos, c) {
  const board = pos.board;
  const list = pos.list;
  const from = c ? 16 : 0;
  const to = from + pos.count[c >> 3];
  for (let i = from; i < to; i++) {
    const type = board[list[i]] & 7;
    if (type >= KNIGHT && type <= QUEEN)
      return 1;
  }
  return 0;
}

function evaluate(node) {

  const pos = node.pos;
  const board = pos.board;

  if (materialDraw(pos))
    return 0;

  const list = pos.list;
  const nw = pos.count[0];  // number of white pieces on board
  const nb = pos.count[1];

  let mgW = 0, mgB = 0, egW = 0, egB = 0;
  let phase = 0;
  let pawns = 0;

  for (let i = 0; i < nw; i++) {
    const sq = list[i];
    const type = board[sq] & 7;
    phase += PHASE[type];
    if (type === PAWN)
      pawns++;
    mgW += MGW[type][sq];
    egW += EGW[type][sq];
  }

  for (let i = 0; i < nb; i++) {
    const sq = list[16 + i];
    const type = board[sq] & 7;
    phase += PHASE[type];
    if (type === PAWN)
      pawns++;
    mgB += MGB[type][sq];
    egB += EGB[type][sq];
  }

  // mop-up: with no pawns the side well ahead pushes the other king to the edge and brings its king up
  // https://www.chessprogramming.org/Mop-up_Evaluation
  if (pawns === 0 && Math.abs(egW - egB) >= MOPUP[2]) {
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

  return e + TEMPO;
}

// ===== config start =====

// material and piece square tables are PeSTO's, https://www.chessprogramming.org/PeSTO%27s_Evaluation_Function

// material by piece https://www.chessprogramming.org/Material
const MAT_MG = [0, 82, 337, 365, 477, 1025, 0];
const MAT_EG = [0, 94, 281, 297, 512, 936, 0];

// bonus for the side to move https://www.chessprogramming.org/Tempo
const TEMPO = 10;

// the game phase weight of each piece, 24 in total at the start https://www.chessprogramming.org/Tapered_Eval
const PHASE = [0, 0, 1, 1, 2, 4, 0];

// mop up in pawnless endings: per step of the losing king from the centre, per step the kings are
// close, the lead needed https://www.chessprogramming.org/Mop-up_Evaluation
const MOPUP = [20, 16, 200];

// piece square tables from white's side, one per piece and phase, black's are mirrored. Each table is
// written a1 first and each row ends in 8 zeros to pad the 0x88 board
// https://www.chessprogramming.org/Piece-Square_Tables
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

// ----- search -----

// reverse futility pruning up to this depth, margin per ply of depth: in a non pv node not in check, if the
// static eval less the margin times depth (one ply less when improving) is still at least beta the node is cut
// https://www.chessprogramming.org/Reverse_Futility_Pruning
const RFP = [8, 100];

// null move from this depth, when the static eval is at least beta and the side to move has a piece, at
// depth reduced by the second value plus depth divided by the third https://www.chessprogramming.org/Null_Move_Pruning
const NULLMOVE = [2, 2, 4];

// futility pruning up to this depth, margin per ply: quiet moves after the first are skipped when the static
// eval plus the margin times depth cannot reach alpha https://www.chessprogramming.org/Futility_Pruning
const FUTILITY = [3, 100];

// late move reductions from this depth, by the second value after the first count of moves and by the fourth
// after the third count, re-searched at full depth if the move beats alpha
// https://www.chessprogramming.org/Late_Move_Reductions
const LMR = [3, 3, 1, 12, 2];

// late move reductions by history: a quiet move with history above the first value is reduced one ply less,
// below the second (negative) one ply more; at the reduction points history is mostly negative, -4000 is about the worst 6%
const LMR_HISTORY = [2000, -4000];

// history bonus on a quiet cutoff: times depth squared, capped; the tables pull towards +-28671 by gravity
// so a bigger bonus means history that says more https://www.chessprogramming.org/History_Heuristic
const HISTORY = [16, 1600];

// aspiration windows from this depth, the width either side of the last score, doubled on a fail until it
// passes the third value, when the window is opened fully https://www.chessprogramming.org/Aspiration_Windows
const ASPIRATION = [4, 30, 500];

// the clock: moves to go if the gui gives none, then the soft and hard limits as a percentage of the
// allocation, the hard limit's cap as a percentage of the time left, and how much of the increment is used
// https://www.chessprogramming.org/Time_Management
const TIME = [30, 50, 300, 50, 50];

// piece values for the static exchange evaluation, by piece type; a capture that loses material by these is
// searched after the quiet moves and not at all in quiescence https://www.chessprogramming.org/Static_Exchange_Evaluation
const SEE_VALUE = [0, 100, 300, 300, 500, 900, 10000];

// ===== config end =====

// the config tables by piece
const BASE_MG = [null, PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
const BASE_EG = [null, PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

// fold material into the tables the eval reads; black's are white's flipped
function evalInitOnce() {
  PHASE_TOTAL = Math.max(1, 4 * (PHASE[KNIGHT] + PHASE[BISHOP] + PHASE[ROOK]) + 2 * PHASE[QUEEN]);
  for (let piece = 1; piece <= 6; piece++) {
    const mgw = MGW[piece] = new Int16Array(128);
    const mgb = MGB[piece] = new Int16Array(128);
    const egw = EGW[piece] = new Int16Array(128);
    const egb = EGB[piece] = new Int16Array(128);
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88)
        continue;
      mgw[sq] = MAT_MG[piece] + BASE_MG[piece][sq];
      mgb[sq] = MAT_MG[piece] + BASE_MG[piece][sq ^ 0x70];
      egw[sq] = MAT_EG[piece] + BASE_EG[piece][sq];
      egb[sq] = MAT_EG[piece] + BASE_EG[piece][sq ^ 0x70];
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

  if (materialDraw(pos))
    return 0;

  // stand pat on the static eval
  const standPat = evaluate(node);
  if (standPat >= beta)
    return standPat;
  if (standPat > alpha)
    alpha = standPat;

  const nextNode = nodes[ply + 1];
  const nextPos = nextNode.pos;
  const stmi = pos.stm >> 3;

  genMoves(node, 1);
  rankMoves(node, ttIndex >= 0 ? ttGetMove(ttIndex) : 0, 1);

  let move;

  while ((move = pickBest(node))) {

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
const NO_EVAL = -32768;  // node.eval when the static eval was not needed, in check

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
  // the parent found whether its move gave check as it made it; the root tests itself
  if (ply === 0)
    node.inCheck = isAttacked(pos, pos.kings[stmi], nstm);
  const inCheck = node.inCheck;

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
  if (!isRoot && (materialDraw(pos) || isDraw(pos, ply)))
    return 0;

  // the static eval, not needed at all in check
  const ev = inCheck ? NO_EVAL : evaluate(node);
  node.eval = ev;

  // improving: the eval is up on two plies ago, so a beta cut needs less https://www.chessprogramming.org/Improving
  const improving = !inCheck && (ply < 2 || ev > nodes[ply - 2].eval) ? 1 : 0;

  // beta pruning aka reverse futility pruning https://www.chessprogramming.org/Reverse_Futility_Pruning
  if (!isPV && !inCheck && depth <= RFP[0] && beta < TT_MATE_BOUND && (ev - (depth - improving) * RFP[1]) >= beta)
    return ev;

  // null move pruning https://www.chessprogramming.org/Null_Move_Pruning
  if (!isPV && !inCheck && !node.noNull && depth >= NULLMOVE[0] && ev >= beta && beta < TT_MATE_BOUND
      && hasPiece(pos, pos.stm)) {
    posSet(nextPos, pos);
    makeNull(nextPos);
    nextNode.noNull = 1;
    nextNode.inCheck = 0;
    const score = -search(depth - 1 - NULLMOVE[1] - ((depth / NULLMOVE[2]) | 0), ply + 1, -beta, -beta + 1);
    nextNode.noNull = 0;
    if (tc.finished)
      return 0;
    if (score >= beta)
      return score >= TT_MATE_BOUND ? beta : score;
  }

  genMoves(node, 0);
  rankMoves(node, ttIndex >= 0 ? ttGetMove(ttIndex) : 0, 0);

  let bestScore = -Infinity;
  let bestMove = 0;
  let numMoves = 0;
  let move;
  node.numQuiets = 0;

  while ((move = pickBest(node))) {

    posSet(nextPos, pos);
    makeMove(move, nextPos);

    if (isAttacked(nextPos, nextPos.kings[stmi], nstm))
      continue;

    numMoves++;
    if (!(move & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK)))
      node.quiets[node.numQuiets++] = move;

    node.piece = pos.board[(move >> 8) & 0xff];

    // does the move give check: the child needs to know anyway, and a checking move is neither pruned nor reduced
    const givesCheck = nextNode.inCheck = isAttacked(nextPos, nextPos.kings[stmi ^ 1], pos.stm) ? 1 : 0;

    // futility pruning - at low depth skip quiet moves when the static eval is well below alpha
    // https://www.chessprogramming.org/Futility_Pruning
    if (!isPV && !inCheck && !givesCheck && depth <= FUTILITY[0] && numMoves > 1 && Math.abs(alpha) < TT_MATE_BOUND
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
      if (depth >= LMR[0] && numMoves > LMR[1] && !inCheck && !givesCheck && move !== node.killer && !(move & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK))) {
        r = numMoves > LMR[3] ? LMR[4] : LMR[2];
        // the move's history, as the ordering scored it, says how far to trust the reduction
        const h = pieceHistory[node.piece][move & 0xff];
        if (h > LMR_HISTORY[0])
          r--;
        else if (h < LMR_HISTORY[1])
          r++;
        if (r < 0)
          r = 0;
      }
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
      if (!(bestMove & (MOVE_FLAG_CAPTURE | MOVE_PROMO_MASK)))
        updateHistories(node, pos, bestMove, depth);
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

// a new game clears the hash, the repetition list and the histories; a new position within a game keeps the
// histories, which asymptote under their gravity rather than being reset every move
function newGame() {
  ttClear();
  repClear();
  historyClear();
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
    if ((score >= TT_MATE_BOUND || score <= -TT_MATE_BOUND) && MATE - Math.abs(score) <= d)
      break;
  }

  uciWrite(`bestmove ${formatMove(tc.bestMove)}`);
}

// https://www.chessprogramming.org/Perft
function perft(depth, ply) {

  if (depth === 0)
    return 1;

  const node = nodes[ply];
  const pos = node.pos;
  const nextPos = nodes[ply + 1].pos;
  const stmi = pos.stm >> 3;

  genMoves(node, 0);

  let tot = 0;

  for (let i = 0; i < node.numMoves; i++) {
    posSet(nextPos, pos);
    makeMove(node.moves[i], nextPos);
    if (isAttacked(nextPos, nextPos.kings[stmi], nextPos.stm))
      continue;
    tot += perft(depth - 1, ply + 1);
  }

  return tot;
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

    case 'stop':  // a search runs to completion, so there is nothing to stop, but a gui expects silence
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
    case 'm':
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
      uciWrite(evaluate(nodes[0]));
      break;

    case 'bench':
    case 'h':
      bench();
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
      uciWrite('moves (m)                   list the legal moves, or checkmate/stalemate if there are none');
      uciWrite('eval (e)                    show the static eval of the current position');
      uciWrite('perft (f) <depth>           count leaf nodes to the given depth');
      uciWrite('bench (h)                   search 50 positions and report nodes and nps');
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
evalInitOnce();
zobInitOnce();
ttInit(TT_DEFAULT_MB);
historyInitOnce();

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
