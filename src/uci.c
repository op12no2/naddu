
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "uci.h"
#include "position.h"

/*{{{  uci_tokens*/

int uci_tokens(int n, char **tokens) {

  const char *cmd = tokens[0];
  const char *sub = tokens[1];

  if (!strcmp(cmd, "isready")) {
    /*{{{  isready*/
    
    printf("readyok\n");
    
    /*}}}*/
  }

  if (!strcmp(cmd,"position")) {
    /*{{{  position*/
    
    if (!strcmp(sub, "startpos")) {
    
      set_position(&g_pos, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", "w", "KQkq", "-", "0");
    
      //if (n > 2 && !strcmp(tokens[2],"moves")) {
        //for (int i=3; i < n; i++)
          //playMove(tokens[i]);
      //}
    }
    
    else if (!strcmp(sub, "fen")) {
    
      set_position(&g_pos, tokens[2], tokens[3], tokens[4], tokens[5], tokens[6]);
    
      //if (n > 8 && !strcmp(tokens[8],"moves")) {
        //for (int i=9; i < n; i++)
          //playMove(tokens[i]);
      //}
    }
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "uci")) {
    /*{{{  uci*/
    
    printf("id name Naddu 1\n");
    printf("id author Colin Jenkins\n");
    printf("uciok\n");
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "b")) {
    /*{{{  board*/
    
    print_position(&g_pos);
    
    /*}}}*/
  }

  else if (!strcmp(cmd, "q")) {
    /*{{{  q*/
    
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

int uci_exec(char *line) {

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

void uci_loop(int argc, char **argv) {

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

