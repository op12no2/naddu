
/*{{{  includes*/

#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>
#include <assert.h>
#include <time.h>
#include <sys/time.h>

/*}}}*/
/*{{{  constants*/

#define MAX_PLY 128
#define MAX_MOVES 256

#define UCI_LINE_LENGTH 8192
#define UCI_TOKENS      8192

#define WHITE_RIGHTS_KING  1
#define WHITE_RIGHTS_QUEEN 2
#define BLACK_RIGHTS_KING  4
#define BLACK_RIGHTS_QUEEN 8
#define ALL_RIGHTS         15

#define EMPTY 255

#define RANK_1 0x00000000000000FFULL
#define RANK_2 0x000000000000FF00ULL
#define RANK_7 0x00FF000000000000ULL
#define RANK_8 0xFF00000000000000ULL

#define RANK_PROMO (RANK_1 | RANK_8)

#define NOT_A_FILE 0xfefefefefefefefeULL
#define NOT_H_FILE 0x7f7f7f7f7f7f7f7fULL

enum {PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING};
enum {WHITE, BLACK};

#define FLAG_PAWN_PUSH  (1 << 12)
#define FLAG_EP_CAPTURE (1 << 13)
#define FLAG_CASTLE     (1 << 14)
#define FLAG_PROMO      (1 << 15)

#define PROMO_SHIFT 17

#define MASK_N_PROMO (FLAG_PROMO | ((KNIGHT-1) << PROMO_SHIFT))
#define MASK_B_PROMO (FLAG_PROMO | ((BISHOP-1) << PROMO_SHIFT))
#define MASK_R_PROMO (FLAG_PROMO | ((ROOK-1)   << PROMO_SHIFT))
#define MASK_Q_PROMO (FLAG_PROMO | ((QUEEN-1)  << PROMO_SHIFT))

#define MASK_SPECIAL (FLAG_PAWN_PUSH | FLAG_EP_CAPTURE | FLAG_CASTLE | FLAG_PROMO)

enum {
  A1, B1, C1, D1, E1, F1, G1, H1,
  A2, B2, C2, D2, E2, F2, G2, H2,
  A3, B3, C3, D3, E3, F3, G3, H3,
  A4, B4, C4, D4, E4, F4, G4, H4,
  A5, B5, C5, D5, E5, F5, G5, H5,
  A6, B6, C6, D6, E6, F6, G6, H6,
  A7, B7, C7, D7, E7, F7, G7, H7,
  A8, B8, C8, D8, E8, F8, G8, H8
};

/*}}}*/
/*{{{  macros*/


/*}}}*/
/*{{{  structs*/

/*{{{  Position struct*/

typedef struct {

  uint64_t all[12];
  uint64_t colour[2];
  uint64_t occupied;

  uint8_t board[64];

  uint8_t stm;
  uint8_t rights;
  uint8_t ep;
  uint8_t hmc;

} __attribute__((aligned(64))) Position;

/*}}}*/
/*{{{  Node struct*/

typedef struct {

  Position pos;

  uint32_t moves[MAX_MOVES];
  int num_moves;

} Node;

/*}}}*/
/*{{{  Attack struct*/

typedef struct {

  int bits;
  int count;
  int shift;

  uint64_t mask;
  uint64_t magic;

  uint64_t *attacks;

} Attack;

/*}}}*/

/*{{{  Perft*/

typedef struct {

  const char *fen;
  int depth;
  uint64_t expected;
  const char *label;

} Perft;

/*}}}*/

/*}}}*/
/*{{{  globals*/

static uint64_t pawn_attacks[2][64];
static uint64_t knight_attacks[64];
static Attack   bishop_attacks[64];
static Attack   rook_attacks[64];
static uint64_t king_attacks[64];

static Node ss[MAX_PLY];

/*{{{  perft fens*/

static const Perft perft_tests[] = {

  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 0, 1,         "cpw-pos1-0"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 1, 20,        "cpw-pos1-1"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 2, 400,       "cpw-pos1-2"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 3, 8902,      "cpw-pos1-3"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 4, 197281,    "cpw-pos1-4"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 5, 4865609,   "cpw-pos1-5"},
  {"p f rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1", 6, 119060324, "cpw-pos1-6"},
  {"p f 4k3/8/8/8/8/8/R7/R3K2R                                  w Q    -  0 1", 3, 4729,      "castling-2"},
  {"p f 4k3/8/8/8/8/8/R7/R3K2R                                  w K    -  0 1", 3, 4686,      "castling-3"},
  {"p f 4k3/8/8/8/8/8/R7/R3K2R                                  w -    -  0 1", 3, 4522,      "castling-4"},
  {"p f r3k2r/r7/8/8/8/8/8/4K3                                  b kq   -  0 1", 3, 4893,      "castling-5"},
  {"p f r3k2r/r7/8/8/8/8/8/4K3                                  b q    -  0 1", 3, 4729,      "castling-6"},
  {"p f r3k2r/r7/8/8/8/8/8/4K3                                  b k    -  0 1", 3, 4686,      "castling-7"},
  {"p f r3k2r/r7/8/8/8/8/8/4K3                                  b -    -  0 1", 3, 4522,      "castling-8"},
  {"p f rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1", 1, 42,        "cpw-pos5-1"},
  {"p f rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1", 2, 1352,      "cpw-pos5-2"},
  {"p f rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1", 3, 53392,     "cpw-pos5-3"},
  {"p f r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1", 1, 48,        "cpw-pos2-1"},
  {"p f r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1", 2, 2039,      "cpw-pos2-2"},
  {"p f r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1", 3, 97862,     "cpw-pos2-3"},
  {"p f 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8                         w -    -  0 1", 5, 674624,    "cpw-pos3-5"},
  {"p f n1n5/PPPk4/8/8/8/8/4Kppp/5N1N                           b -    -  0 1", 1, 24,        "prom-1    "},
  {"p f 8/5bk1/8/2Pp4/8/1K6/8/8                                 w -    d6 0 1", 6, 824064,    "ccc-1     "},
  {"p f 8/8/1k6/8/2pP4/8/5BK1/8                                 b -    d3 0 1", 6, 824064,    "ccc-2     "},
  {"p f 8/8/1k6/2b5/2pP4/8/5K2/8                                b -    d3 0 1", 6, 1440467,   "ccc-3     "},
  {"p f 8/5k2/8/2Pp4/2B5/1K6/8/8                                w -    d6 0 1", 6, 1440467,   "ccc-4     "},
  {"p f 5k2/8/8/8/8/8/8/4K2R                                    w K    -  0 1", 6, 661072,    "ccc-5     "},
  {"p f 4k2r/8/8/8/8/8/8/5K2                                    b k    -  0 1", 6, 661072,    "ccc-6     "},
  {"p f 3k4/8/8/8/8/8/8/R3K3                                    w Q    -  0 1", 6, 803711,    "ccc-7     "},
  {"p f r3k3/8/8/8/8/8/8/3K4                                    b q    -  0 1", 6, 803711,    "ccc-8     "},
  {"p f r3k2r/1b4bq/8/8/8/8/7B/R3K2R                            w KQkq -  0 1", 4, 1274206,   "ccc-9     "},
  {"p f r3k2r/7b/8/8/8/8/1B4BQ/R3K2R                            b KQkq -  0 1", 4, 1274206,   "ccc-10    "},
  {"p f r3k2r/8/3Q4/8/8/5q2/8/R3K2R                             b KQkq -  0 1", 4, 1720476,   "ccc-11    "},
  {"p f r3k2r/8/5Q2/8/8/3q4/8/R3K2R                             w KQkq -  0 1", 4, 1720476,   "ccc-12    "},
  {"p f 2K2r2/4P3/8/8/8/8/8/3k4                                 w -    -  0 1", 6, 3821001,   "ccc-13    "},
  {"p f 3K4/8/8/8/8/8/4p3/2k2R2                                 b -    -  0 1", 6, 3821001,   "ccc-14    "},
  {"p f 8/8/1P2K3/8/2n5/1q6/8/5k2                               b -    -  0 1", 5, 1004658,   "ccc-15    "},
  {"p f 5K2/8/1Q6/2N5/8/1p2k3/8/8                               w -    -  0 1", 5, 1004658,   "ccc-16    "},
  {"p f 4k3/1P6/8/8/8/8/K7/8                                    w -    -  0 1", 6, 217342,    "ccc-17    "},
  {"p f 8/k7/8/8/8/8/1p6/4K3                                    b -    -  0 1", 6, 217342,    "ccc-18    "},
  {"p f 8/P1k5/K7/8/8/8/8/8                                     w -    -  0 1", 6, 92683,     "ccc-19    "},
  {"p f 8/8/8/8/8/k7/p1K5/8                                     b -    -  0 1", 6, 92683,     "ccc-20    "},
  {"p f K1k5/8/P7/8/8/8/8/8                                     w -    -  0 1", 6, 2217,      "ccc-21    "},
  {"p f 8/8/8/8/8/p7/8/k1K5                                     b -    -  0 1", 6, 2217,      "ccc-22    "},
  {"p f 8/k1P5/8/1K6/8/8/8/8                                    w -    -  0 1", 7, 567584,    "ccc-23    "},
  {"p f 8/8/8/8/1k6/8/K1p5/8                                    b -    -  0 1", 7, 567584,    "ccc-24    "},
  {"p f 8/8/2k5/5q2/5n2/8/5K2/8                                 b -    -  0 1", 4, 23527,     "ccc-25    "},
  {"p f 8/5k2/8/5N2/5Q2/2K5/8/8                                 w -    -  0 1", 4, 23527,     "ccc-26    "},
  {"p f 8/p7/8/1P6/K1k3p1/6P1/7P/8                              w -    -  0 1", 8, 8103790,   "jvm-7     "},
  {"p f n1n5/PPPk4/8/8/8/8/4Kppp/5N1N                           b -    -  0 1", 6, 71179139,  "jvm-8     "},
  {"p f r3k2r/p6p/8/B7/1pp1p3/3b4/P6P/R3K2R                     w KQkq -  0 1", 6, 77054993,  "jvm-9     "},
  {"p f 8/5p2/8/2k3P1/p3K3/8/1P6/8                              b -    -  0 1", 8, 64451405,  "jvm-11    "},
  {"p f r3k2r/pb3p2/5npp/n2p4/1p1PPB2/6P1/P2N1PBP/R3K2R         w KQkq -  0 1", 5, 29179893,  "jvm-12    "},
  {"p f 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8                         w -    -  0 1", 7, 178633661, "jvm-10    "},
  {"p f r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1", 5, 193690690, "jvm-6     "},
  {"p f 8/2pkp3/8/RP3P1Q/6B1/8/2PPP3/rb1K1n1r                   w -    -  0 1", 6, 181153194, "ob1       "},
  {"p f rnbqkb1r/ppppp1pp/7n/4Pp2/8/8/PPPP1PPP/RNBQKBNR         w KQkq f6 0 1", 6, 244063299, "jvm-5     "},
  {"p f 8/2ppp3/8/RP1k1P1Q/8/8/2PPP3/rb1K1n1r                   w -    -  0 1", 6, 205552081, "ob2       "},
  {"p f 8/8/3q4/4r3/1b3n2/8/3PPP2/2k1K2R                        w K    -  0 1", 6, 207139531, "ob3       "},
  {"p f 4r2r/RP1kP1P1/3P1P2/8/8/3ppp2/1p4p1/4K2R                b K    -  0 1", 6, 314516438, "ob4       "},
  {"p f r3k2r/8/8/8/3pPp2/8/8/R3K1RR                            b KQkq e3 0 1", 6, 485647607, "jvm-1     "},
  {"p f 8/3K4/2p5/p2b2r1/5k2/8/8/1q6                            b -    -  0 1", 7, 493407574, "jvm-4     "},
  {"p f r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1   w kq   -  0 1", 6, 706045033, "jvm-2     "},
  {"p f r6r/1P4P1/2kPPP2/8/8/3ppp2/1p4p1/R3K2R                  w KQ   -  0 1", 6, 975944981, "ob5       "}

};


/*}}}*/

/*}}}*/

/*{{{  get_ms*/

static inline double get_ms() {

  struct timespec ts;

  clock_gettime(CLOCK_MONOTONIC, &ts);

  return (ts.tv_sec * 1000.0) + (ts.tv_nsec / 1e6);

}

/*}}}*/
/*{{{  shift*/

//static inline uint64_t shift(const uint64_t bb, const int n) {
  //return n > 0 ? bb << n : bb >> -n;
//}

static inline __attribute__((always_inline)) uint64_t shift(uint64_t bb, int n) {
  const uint64_t left  = bb << (n & 63);         // if n = 0
  const uint64_t right = bb >> ((-n) & 63);      // if n < 0
  const uint64_t mask = -(n >= 0);               // 0xFFFFFFFFFFFFFFFF if n = 0, else 0
  return (left & mask) | (right & ~mask);  // select branchlessly
}

/*}}}*/
/*{{{  popcount*/

static inline __attribute__((always_inline)) int popcount(const uint64_t bb) {

  return __builtin_popcountll(bb);

}

/*}}}*/
/*{{{  encode_move*/

static inline __attribute__((always_inline)) uint32_t encode_move(const int from, const int to, const uint32_t flags) {

  return (from << 6) | to | flags;

}

/*}}}*/
/*{{{  bsf*/

static inline __attribute__((always_inline)) int bsf(const uint64_t bb) {

  assert(bb != 0 && "bsf called with zero");

  return __builtin_ctzll(bb);

}

/*}}}*/
/*{{{  xorshift64star*/

static uint64_t rand_seed = 0xDEADBEEFCAFEBABEULL;

static uint64_t xorshift64star(void) {

  rand_seed ^= rand_seed >> 12;
  rand_seed ^= rand_seed << 25;
  rand_seed ^= rand_seed >> 27;

  return rand_seed * 2685821657736338717ULL;

}

/*}}}*/
/*{{{  cleanup*/

static void cleanup() {

  for (int sq = 0; sq < 64; sq++) {

    free(rook_attacks[sq].attacks);
    free(bishop_attacks[sq].attacks);

  }

}

/*}}}*/
/*{{{  piece_index*/

static inline __attribute__((always_inline)) int piece_index(const int piece, const int colour) {

  return piece + colour * 6;

}

/*}}}*/
/*{{{  toggle*/

static inline __attribute__((always_inline)) int toggle(const int stm) {

  return stm ^ 1;

}

/*}}}*/
/*{{{  print_bb*/

static void print_bb(const uint64_t bb, const char *tag) {

  printf("%s\n", tag);

  for (int rank = 7; rank >= 0; rank--) {

    printf("%d  ", rank + 1);

    for (int file = 0; file < 8; file++) {

      int sq = rank * 8 + file;
      char c = (bb & (1ULL << sq)) ? 'x' : '.';

      printf("%c ", c);
    }

    printf("\n");
  }

  printf("\n   a b c d e f g h\n\n");

}

/*}}}*/
/*{{{  pp_move*/

static void pp_move(const uint32_t move) {

  const char files[] = "abcdefgh";
  const char ranks[] = "12345678";

  int from = (move >> 6) & 0x3F;
  int to   = move & 0x3F;

  char buf[7];

  buf[0] = files[from % 8];
  buf[1] = ranks[from / 8];
  buf[2] = files[to % 8];
  buf[3] = ranks[to / 8];

  buf[4] = ' ';

  if (move & FLAG_CASTLE)
    buf[5] = 'C';

  buf[6] = '\0';

  printf("%s\n", buf);

}

/*}}}*/
/*{{{  print_board*/

static void print_board(const Position *pos) {

  const char piece_chars[12] = {
    'P', 'N', 'B', 'R', 'Q', 'K',
    'p', 'n', 'b', 'r', 'q', 'k'
  };

  for (int rank = 7; rank >= 0; rank--) {

    printf("%d  ", rank + 1);

    for (int file = 0; file < 8; file++) {

      int sq = rank * 8 + file;
      uint64_t bb = 1ULL << sq;
      char c = '.';

      for (int i = 0; i < 12; i++) {
        if (pos->all[i] & bb) {
          c = piece_chars[i];
          break;
        }
      }

      printf("%c ", c);
    }

    printf("\n");
  }

  printf("   a b c d e f g h\n");
  printf("ep=%d\n", pos->ep);

}

/*}}}*/

/*{{{  magic_index*/

static inline int magic_index(const uint64_t blockers, const uint64_t magic, const int shift) {

  return (int)((blockers * magic) >> shift);

}

/*}}}*/
/*{{{  get_blockers*/

static void get_blockers(Attack *a, uint64_t *blockers) {

  int bits[64];
  int num_bits = 0;

  for (int b = 0; b < 64; b++) {
    if (a->mask & (1ULL << b)) {
      bits[num_bits++] = b;
    }
  }

  assert(a->bits == num_bits && "wrong bits");

  for (int i = 0; i < a->count; i++) {

    uint64_t blocker = 0;

    for (int j = 0; j < a->bits; j++) {
      if (i & (1 << j)) {
        blocker |= 1ULL << bits[j];
      }
    }

    blockers[i] = blocker;

  }
}

/*}}}*/
/*{{{  find_magics*/

static void find_magics(Attack attacks[64], const char *label) {

  int total_tries = 0;

  printf("\n%-2s %3s %12s %5s  %-18s %6s\n", "T", "Sq", "Tries", "Bits", "Magic", "Fill");
  printf("---------------------------------------------------------------\n");

  for (int sq = 0; sq < 64; sq++) {

    Attack *a = &attacks[sq];

    uint64_t blockers[a->count];
    get_blockers(a, blockers);

    int tries = 0;

    while (1) {

      tries++;

      uint64_t magic = xorshift64star() & xorshift64star() & xorshift64star();

      if (popcount((a->mask * magic) >> (64 - a->bits)) < a->bits - 2)
        continue;

      uint64_t *attacks = calloc(a->count, sizeof(uint64_t));
      if (!attacks) {
        fprintf(stderr, "calloc failed for attacks[%d]\n", sq);
        exit(1);
      }

      int fail = 0, populated = 0;

      for (int i = 0; i < a->count; i++) {
        uint64_t blocker = blockers[i];
        uint64_t attack = a->attacks[i];
        int index = magic_index(blocker, magic, a->shift);

        if (attacks[index] == 0) {
          attacks[index] = attack;
          populated++;
        }

        else if (attacks[index] != attack) {
          fail = 1;
          free(attacks);
          break;
        }
      }

      if (!fail) {
        a->magic = magic;
        free(a->attacks);
        a->attacks = attacks;

        int percent = (100 * populated) / a->count;
        printf("%-2s %3d %12d %5d  0x%016llx %5d%%\n",
               label, sq, tries, a->bits, (unsigned long long)magic, percent);

        total_tries += tries;
        break;
      }
    }
  }

  printf("---------------------------------------------------------------\n");
  printf("Total tries for %s: %d\n\n", label, total_tries);

}

/*}}}*/

/*{{{  init_pawn_attacks*/

// these are attacks *to* the sq and used in pawn_gen (ep) and is_attacked

static void init_pawn_attacks(void) {

  for (int sq = 0; sq < 64; sq++) {

    const uint64_t bb = 1ULL << sq;

    pawn_attacks[WHITE][sq] =
      ((bb >> 7) & NOT_A_FILE) | ((bb >> 9) & NOT_H_FILE);

    pawn_attacks[BLACK][sq] =
      ((bb << 7) & NOT_H_FILE) | ((bb << 9) & NOT_A_FILE);

  }
}

/*}}}*/
/*{{{  init_knight_attacks*/

static void init_knight_attacks(void) {

  for (int sq = 0; sq < 64; sq++) {

    int r = sq / 8, f = sq % 8;
    uint64_t bb = 0;

    int dr[8] = {-2, -1, 1, 2, 2, 1, -1, -2};
    int df[8] = {1, 2, 2, 1, -1, -2, -2, -1};

    for (int i = 0; i < 8; i++) {
      int nr = r + dr[i], nf = f + df[i];
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8)
        bb |= 1ULL << (nr * 8 + nf);
    }

    knight_attacks[sq] = bb;

  }
}

/*}}}*/
/*{{{  init_bishop_attacks*/

static void init_bishop_attacks(void) {

  for (int sq = 0; sq < 64; sq++) {

    Attack *a = &bishop_attacks[sq];

    /*{{{  build mask*/
    
    int rank = sq / 8;
    int file = sq % 8;
    
    a->mask = 0;
    
    for (int r = rank + 1, f = file + 1; r <= 6 && f <= 6; r++, f++)
      a->mask |= 1ULL << (r * 8 + f);
    
    for (int r = rank + 1, f = file - 1; r <= 6 && f >= 1; r++, f--)
      a->mask |= 1ULL << (r * 8 + f);
    
    for (int r = rank - 1, f = file + 1; r >= 1 && f <= 6; r--, f++)
      a->mask |= 1ULL << (r * 8 + f);
    
    for (int r = rank - 1, f = file - 1; r >= 1 && f >= 1; r--, f--)
      a->mask |= 1ULL << (r * 8 + f);
    
    /*}}}*/

    a->bits = popcount(a->mask);
    a->shift = 64 - a->bits;
    a->count = 1 << a->bits;

    a->attacks = malloc(a->count * sizeof(uint64_t));
    if (!a->attacks) {
      fprintf(stderr, "malloc failed for bishop_attacks[%d]\n", sq);
      cleanup();
      exit(1);
    }

    uint64_t blockers[a->count];
    get_blockers(a, blockers);

    for (int i = 0; i < a->count; i++) {
      /*{{{  build attacks[i]*/
      
      uint64_t blocker = blockers[i];
      uint64_t attack = 0;
      
      for (int r = rank + 1, f = file + 1; r <= 7 && f <= 7; r++, f++) {
        int s = r * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s))
          break;
      }
      
      for (int r = rank + 1, f = file - 1; r <= 7 && f >= 0; r++, f--) {
        int s = r * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s))
          break;
      }
      
      for (int r = rank - 1, f = file + 1; r >= 0 && f <= 7; r--, f++) {
        int s = r * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s))
          break;
      }
      
      for (int r = rank - 1, f = file - 1; r >= 0 && f >= 0; r--, f--) {
        int s = r * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s))
          break;
      }
      
      a->attacks[i] = attack;
      
      /*}}}*/
    }
  }

  find_magics(bishop_attacks, "B");

}

/*}}}*/
/*{{{  init_rook_attacks*/

static void init_rook_attacks(void) {

  for (int sq = 0; sq < 64; sq++) {

    Attack *a = &rook_attacks[sq];

    /*{{{  build mask*/
    
    int rank = sq / 8;
    int file = sq % 8;
    
    a->mask = 0;
    
    for (int f = file + 1; f <= 6; f++)
      a->mask |= 1ULL << (rank * 8 + f);
    
    for (int f = file - 1; f >= 1; f--)
      a->mask |= 1ULL << (rank * 8 + f);
    
    for (int r = rank + 1; r <= 6; r++)
      a->mask |= 1ULL << (r * 8 + file);
    
    for (int r = rank - 1; r >= 1; r--)
      a->mask |= 1ULL << (r * 8 + file);
    
    /*}}}*/

    a->bits = popcount(a->mask);
    a->shift = 64 - a->bits;
    a->count = 1 << a->bits;

    a->attacks = malloc(a->count * sizeof(uint64_t));
    if (!a->attacks) {
      fprintf(stderr, "malloc failed for attacks[%d]\n", sq);
      cleanup();
      exit(1);
    }

    uint64_t blockers[a->count];
    get_blockers(a, blockers);

    for (int i = 0; i < a->count; i++) {
      /*{{{  build attacks[i]*/
      
      uint64_t blocker = blockers[i];
      uint64_t attack = 0;
      
      // North
      for (int r = rank + 1; r <= 7; r++) {
        int s = r * 8 + file;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s)) {
          break;
        }
      }
      
      // South
      for (int r = rank - 1; r >= 0; r--) {
        int s = r * 8 + file;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s)) {
          break;
        }
      }
      
      // East
      for (int f = file + 1; f <= 7; f++) {
        int s = rank * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s)) {
          break;
        }
      }
      
      // West
      for (int f = file - 1; f >= 0; f--) {
        int s = rank * 8 + f;
        attack |= 1ULL << s;
        if (blocker & (1ULL << s)) {
          break;
        }
      }
      
      a->attacks[i] = attack;
      
      /*}}}*/
    }
  }

  find_magics(rook_attacks, "R");

}

/*}}}*/
/*{{{  init_king_attacks*/

static void init_king_attacks(void) {

  for (int sq = 0; sq < 64; sq++) {

    int r = sq / 8, f = sq % 8;
    uint64_t bb = 0;

    for (int dr = -1; dr <= 1; dr++) {
      for (int df = -1; df <= 1; df++) {
        if (dr == 0 && df == 0) continue;
        int nr = r + dr, nf = f + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8)
          bb |= 1ULL << (nr * 8 + nf);
      }
    }

    king_attacks[sq] = bb;

  }
}

/*}}}*/

/*{{{  position*/

static void position(Position *pos, const char *board_fen, const char *stm_str, const char *rights_str, const char *ep_str) {

  const int char_to_piece[128] = {
    ['p'] = 0, ['n'] = 1, ['b'] = 2, ['r'] = 3, ['q'] = 4, ['k'] = 5,
  };

  memset(pos, 0, sizeof(Position));

  /*{{{  board*/
  
  for (int i=0; i < 64; i++)
    pos->board[i] = EMPTY;
  
  int sq = 56;
  
  for (const char *p = board_fen; *p; ++p) {
  
    if (*p == '/') {
      sq -= 16;
    }
  
    else if (isdigit(*p)) {
      sq += *p - '0';
    }
  
    else {
  
      int colour = !!islower(*p);
      int piece = char_to_piece[tolower(*p)];
      int index = piece_index(piece, colour);
  
      uint64_t bb = 1ULL << sq;
  
      pos->all[index]     |= bb;
      pos->occupied       |= bb;
      pos->colour[colour] |= bb;
  
      pos->board[sq] = index;
  
      sq++;
  
    }
  }
  
  /*}}}*/
  /*{{{  stm*/
  
  pos->stm = (stm_str[0] == 'w') ? WHITE : BLACK;
  
  /*}}}*/
  /*{{{  rights*/
  
  pos->rights = 0;
  
  for (const char *p = rights_str; *p; ++p) {
    switch (*p) {
      case 'K': pos->rights |= WHITE_RIGHTS_KING; break;
      case 'Q': pos->rights |= WHITE_RIGHTS_QUEEN; break;
      case 'k': pos->rights |= BLACK_RIGHTS_KING; break;
      case 'q': pos->rights |= BLACK_RIGHTS_QUEEN; break;
    }
  }
  
  /*}}}*/
  /*{{{  ep*/
  
  if (ep_str[0] == '-') {
    pos->ep = 0;  // 0 is not a legal ep square so this is ok
  }
  
  else {
  
    int file = ep_str[0] - 'a';
    int rank = ep_str[1] - '1';
  
    pos->ep = rank * 8 + file;
  
  }
  
  /*}}}*/
  /*{{{  hmc*/
  
  pos->hmc = 0;
  
  /*}}}*/

}

/*}}}*/
/*{{{  is_attacked*/

static inline int is_attacked(const Position * __restrict pos, int sq, const int opp) {

  if (pos->all[piece_index(PAWN, opp)] & pawn_attacks[opp][sq])
    return 1;

  if (pos->all[piece_index(KNIGHT, opp)] & knight_attacks[sq])
    return 1;

  if (pos->all[piece_index(KING, opp)] & king_attacks[sq])
    return 1;

  Attack *a = &bishop_attacks[sq];
  uint64_t blockers = pos->occupied & a->mask;
  int idx = magic_index(blockers, a->magic, a->shift);
  uint64_t attacks = a->attacks[idx];
  if (attacks & (pos->all[piece_index(BISHOP, opp)] | pos->all[piece_index(QUEEN, opp)]))
    return 1;

  a = &rook_attacks[sq];
  blockers = pos->occupied & a->mask;
  idx = magic_index(blockers, a->magic, a->shift);
  attacks = a->attacks[idx];
  if (attacks & (pos->all[piece_index(ROOK, opp)] | pos->all[piece_index(QUEEN, opp)]))
    return 1;

  return 0;

}

/*}}}*/

/*{{{  gen_sliders*/

static inline void gen_sliders(Node *node, Attack *attack_table, const int piece) {

  const Position *pos = &node->pos;
  const int stm = pos->stm;
  const uint64_t friends = pos->colour[stm];
  //const uint64_t enemies = pos->colour[toggle(stm)];
  const uint64_t opp_king = pos->all[piece_index(KING, toggle(stm))];

  uint64_t bb = pos->all[piece_index(piece, stm)];

  while (bb) {

    const int from = bsf(bb);
    bb &= bb - 1;

    const Attack *a = &attack_table[from];
    const uint64_t blockers = pos->occupied & a->mask;
    const int index = magic_index(blockers, a->magic, a->shift);

    uint64_t attacks = a->attacks[index] & ~friends & ~opp_king;

    while (attacks) {

      const int to = bsf(attacks);
      attacks &= attacks - 1;

      node->moves[node->num_moves++] = encode_move(from, to, 0);

    }
  }
}

/*}}}*/
/*{{{  gen_jumpers*/

// hack scope to parallelise k and n

static inline void gen_jumpers(Node *node, const uint64_t *attack_table, const int piece) {

  const Position *pos = &node->pos;
  const int stm = pos->stm;
  const uint64_t friends = pos->colour[stm];
  //const uint64_t enemies = pos->colour[toggle(stm)];
  const uint64_t opp_king = pos->all[piece_index(KING, toggle(stm))];

  uint64_t bb = pos->all[piece_index(piece, stm)];

  while (bb) {

    const int from = bsf(bb);
    bb &= bb - 1;

    uint64_t attacks = attack_table[from] & ~friends & ~opp_king;

    while (attacks) {

      const int to = bsf(attacks);
      attacks &= attacks - 1;

      node->moves[node->num_moves++] = encode_move(from, to, 0);

    }
  }
}

/*}}}*/
/*{{{  gen_pawns*/

static const uint64_t home_rank[2] = {RANK_2, RANK_7};
static const int orth_offset[2]    = {8, -8};
static const int left_offset[2]    = {7, -9};
static const int right_offset[2]   = {9, -7};

static void gen_pawns(Node *node) {

  const Position *pos = &node->pos;
  const int stm = pos->stm;
  const int opp = toggle(stm);

  const uint64_t pawns    = pos->all[piece_index(PAWN, stm)];
  const uint64_t occupied = pos->occupied;
  const uint64_t enemies  = pos->colour[opp];
  const uint64_t opp_king = pos->all[piece_index(KING, opp)];

  /*{{{  push 1*/
  
  int offset = orth_offset[stm];
  uint64_t bb = shift(pawns, offset) & ~occupied;
  uint64_t quiet_bb = bb & ~RANK_PROMO;
  uint64_t promo_bb = bb & RANK_PROMO;
  
  while (quiet_bb) {
    const int to = bsf(quiet_bb);
    quiet_bb &= quiet_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, 0);
  }
  
  while (promo_bb) {
    const int to = bsf(promo_bb);
    promo_bb &= promo_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_Q_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_R_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_B_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_N_PROMO);
  }
  
  /*}}}*/
  /*{{{  push 2*/
  
  bb = pawns & home_rank[stm];
  bb = shift(bb, offset) & ~occupied;
  bb = shift(bb, offset) & ~occupied;
  
  offset += offset;
  
  while (bb) {
    const int to = bsf(bb);
    bb &= bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, FLAG_PAWN_PUSH);
  }
  
  /*}}}*/
  /*{{{  left*/
  
  offset = left_offset[stm];
  bb = shift(pawns, offset) & enemies & NOT_H_FILE & ~opp_king;
  quiet_bb = bb & ~RANK_PROMO;
  promo_bb = bb & RANK_PROMO;
  
  while (quiet_bb) {
    const int to = bsf(quiet_bb);
    quiet_bb &= quiet_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, 0);
  }
  
  while (promo_bb) {
    const int to = bsf(promo_bb);
    promo_bb &= promo_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_Q_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_R_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_B_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_N_PROMO);
  }
  
  /*}}}*/
  /*{{{  right*/
  
  // hack scope to parallelise with left
  
  offset = right_offset[stm];
  bb = shift(pawns, offset) & enemies & NOT_A_FILE & ~opp_king;
  quiet_bb = bb & ~RANK_PROMO;
  promo_bb = bb & RANK_PROMO;
  
  while (quiet_bb) {
    const int to = bsf(quiet_bb);
    quiet_bb &= quiet_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, 0);
  }
  
  while (promo_bb) {
    const int to = bsf(promo_bb);
    promo_bb &= promo_bb - 1;
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_Q_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_R_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_B_PROMO);
    node->moves[node->num_moves++] = encode_move(to - offset, to, MASK_N_PROMO);
  }
  
  /*}}}*/

  if (pos->ep) {
    /*{{{  ep*/
    
    bb = pawn_attacks[stm][pos->ep] & pawns;
    
    while (bb) {
      const int from = bsf(bb);
      bb &= bb - 1;
      node->moves[node->num_moves++] = encode_move(from, pos->ep, FLAG_EP_CAPTURE);
    }
    
    /*}}}*/
  }

}

/*}}}*/
/*{{{  gen_castling*/

//hack optimise/generalise

static void gen_castling(Node *node) {

  const Position *pos = &node->pos;
  const int stm = pos->stm;
  const int opp = toggle(stm);

  const uint64_t occupied = pos->occupied;

  if (stm == WHITE) {
    if ((pos->rights & WHITE_RIGHTS_KING) &&
        !(occupied & 0x0000000000000060ULL) &&
        !is_attacked(pos, E1, opp) &&
        !is_attacked(pos, F1, opp) &&
        !is_attacked(pos, G1, opp)) {
      node->moves[node->num_moves++] = encode_move(E1, G1, FLAG_CASTLE);
    }
    if ((pos->rights & WHITE_RIGHTS_QUEEN) &&
        !(occupied & 0x000000000000000EULL) &&
        !is_attacked(pos, E1, opp) &&
        !is_attacked(pos, D1, opp) &&
        !is_attacked(pos, C1, opp)) {
      node->moves[node->num_moves++] = encode_move(E1, C1, FLAG_CASTLE);
    }
  }
  else {
    if ((pos->rights & BLACK_RIGHTS_KING) &&
        !(occupied & 0x6000000000000000ULL) &&
        !is_attacked(pos, E8, opp) &&
        !is_attacked(pos, F8, opp) &&
        !is_attacked(pos, G8, opp)) {
      node->moves[node->num_moves++] = encode_move(E8, G8, FLAG_CASTLE);
    }
    if ((pos->rights & BLACK_RIGHTS_QUEEN) &&
        !(occupied & 0x0E00000000000000ULL) &&
        !is_attacked(pos, E8, opp) &&
        !is_attacked(pos, D8, opp) &&
        !is_attacked(pos, C8, opp)) {
      node->moves[node->num_moves++] = encode_move(E8, C8, FLAG_CASTLE);
    }
  }
}

/*}}}*/
/*{{{  gen_moves*/

static void gen_moves(Node *node) {

  node->num_moves = 0;

  gen_pawns(node);
  gen_jumpers(node, knight_attacks, KNIGHT);
  gen_sliders(node, bishop_attacks, BISHOP);
  gen_sliders(node, rook_attacks,   ROOK);
  gen_sliders(node, rook_attacks,   QUEEN);
  gen_sliders(node, bishop_attacks, QUEEN);
  gen_jumpers(node, king_attacks,   KING);
  gen_castling(node);

}

/*}}}*/

/*{{{  make_move*/

/*{{{  helper tables*/

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winitializer-overrides"

static const uint8_t rook_to[64] = {
  [G1] = F1,
  [C1] = D1,
  [G8] = F8,
  [C8] = D8,
};

static const uint8_t rook_from[64] = {
  [G1] = H1,
  [C1] = A1,
  [G8] = H8,
  [C8] = A8,
};

static const uint8_t rights_mask[64] = {
  [0 ... 63] = ALL_RIGHTS,
  [A1] = ALL_RIGHTS & ~WHITE_RIGHTS_QUEEN,
  [H1] = ALL_RIGHTS & ~WHITE_RIGHTS_KING,
  [E1] = ALL_RIGHTS & ~(WHITE_RIGHTS_KING | WHITE_RIGHTS_QUEEN),

  [A8] = ALL_RIGHTS & ~BLACK_RIGHTS_QUEEN,
  [H8] = ALL_RIGHTS & ~BLACK_RIGHTS_KING,
  [E8] = ALL_RIGHTS & ~(BLACK_RIGHTS_KING | BLACK_RIGHTS_QUEEN)
};

/*}}}*/

static void make_move(Position * __restrict pos, const uint64_t move) {

  const int from = (move >> 6) & 0x3F;
  const int to   = move & 0x3F;

  const uint64_t from_bb = 1ULL << from;
  const uint64_t to_bb   = 1ULL << to;

  const int stm = pos->stm;
  const int opp = toggle(stm);

  const int from_piece = pos->board[from];
  const int to_piece   = pos->board[to];

  /*{{{  remove from piece*/
  
  pos->all[from_piece] &= ~from_bb;
  pos->colour[stm]     &= ~from_bb;
  
  pos->board[from] = EMPTY;
  
  /*}}}*/

  if (to_piece != EMPTY) {
    /*{{{  remove to piece*/
    
    pos->all[to_piece] &= ~to_bb;
    pos->colour[opp]   &= ~to_bb;
    
    /*}}}*/
  }

  /*{{{  move from piece*/
  
  pos->all[from_piece] |= to_bb;
  pos->colour[stm]     |= to_bb;
  
  pos->board[to] = from_piece;
  
  /*}}}*/

  pos->ep = 0;
  pos->rights &= rights_mask[from] & rights_mask[to];

  if (move & MASK_SPECIAL) {
    /*{{{  specials*/
    
    // hack - use an indirect fun call? measure it - maybe different make_move versions
    
    if (move & FLAG_PROMO) {
      /*{{{  promo*/
      
      const int pro = piece_index(((move >> PROMO_SHIFT) & 3) + 1, stm);
      
      pos->all[from_piece] &= ~to_bb;
      pos->all[pro]        |= to_bb;
      
      pos->board[to] = pro;
      
      /*}}}*/
    }
    
    else if (move & FLAG_EP_CAPTURE) {
      /*{{{  ep*/
      
      const int pawn_sq = to + orth_offset[opp];
      const uint64_t pawn_bb = 1ULL << pawn_sq;
      
      pos->all[piece_index(PAWN, opp)] &= ~pawn_bb;
      pos->colour[opp] &= ~pawn_bb;
      pos->board[pawn_sq] = EMPTY;
      
      /*}}}*/
    }
    
    else if (move & FLAG_PAWN_PUSH) {
      /*{{{  set ep*/
      
      pos->ep = from + orth_offset[stm];
      
      /*}}}*/
    }
    
    else if (move & FLAG_CASTLE) {
      /*{{{  castle*/
      
      const int rook = piece_index(ROOK, stm);
      
      uint64_t rook_from_bb = 1ULL << rook_from[to];
      uint64_t rook_to_bb   = 1ULL << rook_to[to];
      
      pos->all[rook]   &= ~rook_from_bb;
      pos->colour[stm] &= ~rook_from_bb;
      pos->board[rook_from[to]] = EMPTY;
      
      pos->all[rook]   |= rook_to_bb;
      pos->colour[stm] |= rook_to_bb;
      pos->board[rook_to[to]] = rook;
      
      /*}}}*/
    }
    
    
    /*}}}*/
  }

  pos->occupied = pos->colour[WHITE] | pos->colour[BLACK];
  pos->stm = opp;

}

/*}}}*/

/*{{{  perft*/

static uint64_t perft(int ply, int depth) {

  if (depth == 0)
    return 1;

  Node *node = &ss[ply];
  Node *next = &ss[ply+1];

  gen_moves(node);

  const int stm = node->pos.stm;
  const int opp = toggle(stm);

  const int king = piece_index(KING, stm);

  uint64_t total_searched = 0;

  for (int i=0; i < node->num_moves; i++) {

    next->pos = node->pos;

    make_move(&next->pos, node->moves[i]);

    int king_sq = bsf(next->pos.all[king]);
    if (is_attacked(&next->pos, king_sq, opp)) {
      continue;
    }

    uint64_t nodes_searched = perft(ply+1, depth-1);

    total_searched += nodes_searched;

  }

  return total_searched;

}

/*}}}*/

/*{{{  uci_tokens*/

static int uci_exec(char *line);

static int uci_tokens(int n, char **tokens) {

  if (n == 0)
    return 0;

  const char *cmd = tokens[0];
  const char *sub = tokens[1];

  if (!strcmp(cmd, "isready")) {
    /*{{{  isready*/
    
    printf("readyok\n");
    
    /*}}}*/
  }

  if (!strcmp(cmd, "position") || !strcmp(cmd, "p")) {
    /*{{{  position*/
    
    if (!strcmp(sub, "startpos") || !strcmp(sub, "s")) {
    
      position(&ss[0].pos, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", "w", "KQkq", "-");
    
      //if (n > 2 && !strcmp(tokens[2],"moves")) {
        //for (int i=3; i < n; i++)
          //playMove(tokens[i]);
      //}
    }
    
    else if (!strcmp(sub, "fen") || !strcmp(sub, "f") ) {
    
      position(&ss[0].pos, tokens[2], tokens[3], tokens[4], tokens[5]);
    
      //if (n > 8 && !strcmp(tokens[8],"moves")) {
        //for (int i=9; i < n; i++)
          //playMove(tokens[i]);
      //}
    }
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "uci")) {
    /*{{{  uci*/
    
    printf("id name Lozza 8c\n");
    printf("id author Colin Jenkins\n");
    printf("uciok\n");
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "b")) {
    /*{{{  board*/
    
    print_board(&ss[0].pos);
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "m")) {
    /*{{{  moves*/
    
    Node *node = &ss[0];
    Node *next = &ss[1];
    
    gen_moves(node);
    
    const int stm = node->pos.stm;
    const int opp = toggle(stm);
    
    for (int i=0; i < node->num_moves; i++) {
    
      memcpy(&next->pos, &node->pos, sizeof(Position));
    
      uint32_t move = node->moves[i];
    
      make_move(&next->pos, move);
    
      int king_sq = bsf(next->pos.all[piece_index(KING, stm)]);
    
      if (is_attacked(&next->pos, king_sq, opp)) {
        continue;
      }
    
      pp_move(move);
    
    }
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "perft") || !strcmp(cmd, "f")) {
    /*{{{  perft*/
    
    const int depth = atoi(sub);
    double start = get_ms();
    uint64_t total_nodes = 0;
    
    for (int d=0; d <= depth; d++) {
      uint64_t num_nodes = perft(0, d);
      total_nodes += num_nodes;
      printf("perft(%d) = %llu\n", d, (unsigned long long)num_nodes);
    }
    
    double end = get_ms();
    
    double elapsed_ms = end - start;
    double nps = (elapsed_ms > 0.0) ? (total_nodes / (elapsed_ms / 1000.0)) : 0;
    
    printf("time = %.2f ms,  nps = %.0f\n", elapsed_ms, nps);
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "pt")) {
    /*{{{  perft tests*/
    
    const int num_tests = 64;
    //const int num_tests = 14;
    
    double start = get_ms();
    
    uint64_t total_nodes = 0;
    
    for (int i = 0; i < num_tests; i++) {
    
      const Perft *test = &perft_tests[i];
    
      char line[UCI_LINE_LENGTH];
      strncpy(line, test->fen, sizeof(line) - 1);
      line[sizeof(line) - 1] = '\0';
    
      int r = uci_exec(line);
    
      uint64_t num_nodes = perft(0, test->depth);
      total_nodes += num_nodes;
    
      printf("%s %d %llu %llu (%lu)\n",
      test->fen,
      test->depth,
      (unsigned long long)num_nodes,
      (unsigned long long)test->expected,
      num_nodes - test->expected);
    
    }
    
    double end = get_ms();
    
    double elapsed_ms = end - start;
    double nps = (elapsed_ms > 0.0) ? (total_nodes / (elapsed_ms / 1000.0)) : 0;
    
    printf("time = %.2f ms,  nps = %.0f\n", elapsed_ms, nps);
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "q")) {
    /*{{{  quit*/
    
    return 1;
    
    /*}}}*/
  }

  else {
    printf("?\n");
  }

  return 0;

}

/*}}}*/
/*{{{  uci_exec*/

static int uci_exec(char *line) {

  char *tokens[UCI_TOKENS];
  char *token;

  int num_tokens = 0;

  token = strtok(line, " \t\n");

  while (token != NULL && num_tokens < UCI_TOKENS) {

    tokens[num_tokens++] = token;

    token = strtok(NULL, " \r\t\n");
  }

  return uci_tokens(num_tokens, tokens);

}

/*}}}*/
/*{{{  uci_loop*/

static void uci_loop(int argc, char **argv) {

  setvbuf(stdout, NULL, _IONBF, 0);

  char chunk[UCI_LINE_LENGTH];

  for (int i=1; i < argc; i++) {
    if (uci_exec(argv[i]))
      return;
  }

  while (fgets(chunk, sizeof(chunk), stdin) != NULL) {
    if (uci_exec(chunk))
      return;
  }

}

/*}}}*/

/*{{{  init_once*/

static void init_once() {

 _Static_assert(sizeof(Position) % 64 == 0, "Position size should be multiple of 64");

  struct timeval start, end;
  gettimeofday(&start, NULL);

  memset(ss, 0, sizeof(ss));

  init_pawn_attacks();
  init_knight_attacks();
  init_bishop_attacks();
  init_rook_attacks();
  init_king_attacks();

  gettimeofday(&end, NULL);

  long ms = (end.tv_sec - start.tv_sec) * 1000 +
            (end.tv_usec - start.tv_usec) / 1000;

  printf("init_once: total time = %ld ms\n", ms);

}

/*}}}*/

/*{{{  main*/

int main(int argc, char **argv) {

  init_once();
  uci_loop(argc, argv);

  cleanup();

  return 0;

}

/*}}}*/

