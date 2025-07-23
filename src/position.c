
#include <stdio.h>
#include <string.h>
#include <ctype.h>
#include <stdlib.h>
#include <stdint.h>
#include "position.h"

/*{{{  char to piece mapping*/

static uint8_t char_to_piece(char c) {
  switch (c) {
    case 'P': return WPAWN;
    case 'N': return WKNIGHT;
    case 'B': return WBISHOP;
    case 'R': return WROOK;
    case 'Q': return WQUEEN;
    case 'K': return WKING;
    case 'p': return BPAWN;
    case 'n': return BKNIGHT;
    case 'b': return BBISHOP;
    case 'r': return BROOK;
    case 'q': return BQUEEN;
    case 'k': return BKING;
    default:  return EMPTY;
  }
}

/*}}}*/
/*{{{  piece_to_char mapping*/

static char piece_to_char(uint8_t piece) {
  switch (piece) {
    case WPAWN:   return 'P';
    case WKNIGHT: return 'N';
    case WBISHOP: return 'B';
    case WROOK:   return 'R';
    case WQUEEN:  return 'Q';
    case WKING:   return 'K';
    case BPAWN:   return 'p';
    case BKNIGHT: return 'n';
    case BBISHOP: return 'b';
    case BROOK:   return 'r';
    case BQUEEN:  return 'q';
    case BKING:   return 'k';
    default:      return '.';
  }
}

/*}}}*/
/*{{{  square_from_string*/

static int square_from_string(const char *s) {

  if (s[0] < 'a' || s[0] > 'h' || s[1] < '1' || s[1] > '8')
    return -1;

  return (s[1] - '1') * 8 + (s[0] - 'a');

}

/*}}}*/
/*{{{  print_castling_rights*/

static void print_castling_rights(uint8_t rights) {

  if (rights == 0) {
    printf("-");
    return;
  }

  if (rights & WHITE_RIGHTS_KING)  printf("K");
  if (rights & WHITE_RIGHTS_QUEEN) printf("Q");
  if (rights & BLACK_RIGHTS_KING)  printf("k");
  if (rights & BLACK_RIGHTS_QUEEN) printf("q");

}

/*}}}*/
/*{{{  print_ep*/

static void print_ep(uint8_t ep) {

  if (ep == 0xFF) {
    printf("-");
    return;
  }

  char file = 'a' + (ep % 8);
  char rank = '1' + (ep / 8);

  printf("%c%c", file, rank);

}

/*}}}*/
/*{{{  print_fen*/

static void print_fen(Position *pos) {

  for (int rank = 7; rank >= 0; rank--) {
    int empty = 0;
    for (int file = 0; file < 8; file++) {
      int sq = rank * 8 + file;
      uint8_t piece = pos->board[sq];
      if (piece == EMPTY) {
        empty++;
      }
      else {
        if (empty) {
          printf("%d", empty);
          empty = 0;
        }
        putchar(piece_to_char(piece));
      }
    }
    if (empty) printf("%d", empty);
    if (rank > 0) putchar('/');
  }

}

/*}}}*/

/*{{{  set_position*/

void set_position(Position *pos, char *board, char *stm, char *rights, char *ep, char *hmc) {

  memset(pos->board, 0, sizeof(pos->board));

  int square = 56;
  for (int i = 0; board[i] && square >= 0; i++) {
    char c = board[i];
    if (c == '/') {
      square -= 16;
    }
    else if (isdigit(c)) {
      square += c - '0';
    }
    else {
      pos->board[square++] = char_to_piece(c);
    }
  }

  pos->stm = (stm[0] == 'w') ? WHITE : BLACK;

  pos->rights = 0;
  for (int i = 0; rights[i]; i++) {
    switch (rights[i]) {
      case 'K': pos->rights |= WHITE_RIGHTS_KING; break;
      case 'Q': pos->rights |= WHITE_RIGHTS_QUEEN; break;
      case 'k': pos->rights |= BLACK_RIGHTS_KING; break;
      case 'q': pos->rights |= BLACK_RIGHTS_QUEEN; break;
      default: break;
    }
  }

  if (strcmp(ep, "-") != 0) {
    int sq = square_from_string(ep);
    if (sq >= 0 && sq < 64)
      pos->ep = (uint8_t)sq;
    else
      pos->ep = 0xFF;  // invalid square
  }
  else {
    pos->ep = 0xFF;
  }

  pos->hmc = (uint8_t)atoi(hmc);

}

/*}}}*/
/*{{{  print_position*/

void print_position(Position *pos) {

  printf("\n  +-----------------+\n");

  for (int rank = 7; rank >= 0; rank--) {
    printf("%d |", rank + 1);
    for (int file = 0; file < 8; file++) {
      int sq = rank * 8 + file;
      char c = piece_to_char(pos->board[sq]);
      printf(" %c", c);
    }
    printf(" |\n");
  }

  printf("  +-----------------+\n");
  printf("    a b c d e f g h\n");

  printf("fen: ");
  print_fen(pos);

  printf("\nstm: %s\n", (pos->stm == WHITE ? "w" : "b"));

  printf("rights: ");
  print_castling_rights(pos->rights);
  printf("\n");

  printf("ep: ");
  print_ep(pos->ep);
  printf("\n");

  printf("hmc: %d\n\n", pos->hmc);

}

/*}}}*/

