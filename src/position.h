
#ifndef POSITION_H
#define POSITION_H

#define WHITE 0
#define BLACK 8

#define WHITE_RIGHTS_KING  1
#define WHITE_RIGHTS_QUEEN 2
#define BLACK_RIGHTS_KING  4
#define BLACK_RIGHTS_QUEEN 8


enum {
  EMPTY = 0,

  WPAWN = 1,
  WKNIGHT,
  WBISHOP,
  WROOK,
  WQUEEN,
  WKING,

  BPAWN = WPAWN | BLACK,
  BKNIGHT,
  BBISHOP,
  BROOK,
  BQUEEN,
  BKING
};

typedef struct {
  uint8_t board[64];
  uint8_t stm;
  uint8_t rights;
  uint8_t ep;
  uint8_t hmc;
} Position;

extern Position g_pos;

void set_position(Position *pos, char *board, char *stm, char *rights, char *ep, char *hmc);
void print_position(Position *pos);

#endif

