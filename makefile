
CC      = clang
CFLAGS  = -O3 -march=native -Wall -Wextra 
LDFLAGS = -flto
TARGET  = naddu

SRCS    = naddu.c
OBJS    = $(SRCS:.c=.o)

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(TARGET) $(OBJS)

