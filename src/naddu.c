
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "uci.h"
#include "position.h"

Position g_pos;

int main(int argc, char **argv) {

  uci_loop(argc, argv);

  return 0;

}

