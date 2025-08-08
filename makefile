
CC       = clang
TARGET   = naddu
BUILD    ?= debug

SRCS     = naddu.c
OBJS     = $(SRCS:.c=.o)

ifeq ($(BUILD),release)
  CFLAGS  = -O3 -march=native -flto -DNDEBUG
  LDFLAGS = -flto -s
else ifeq ($(BUILD),debug)
  CFLAGS  = -O0 -g -Wall -Wextra
  LDFLAGS =
else
  $(error Unknown BUILD type: $(BUILD))
endif

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(TARGET) $(OBJS)



