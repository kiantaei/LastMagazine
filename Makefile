CXX ?= g++
EMCC ?= em++

CXXFLAGS ?= -std=c++17 -Wall -Wextra -O2 -Isrc -Isrc/vendor
LDFLAGS_NATIVE ?= -lmingw32 -lSDL2main -lSDL2 -lopengl32

SRCS = src/main.cpp \
       src/engine/core/logger.cpp \
       src/engine/core/time.cpp \
       src/engine/core/window.cpp \
       src/engine/input/input_manager.cpp \
       src/engine/audio/audio_system.cpp \
       src/engine/renderer/gl_loader.cpp \
       src/engine/renderer/shader.cpp \
       src/game/game_app.cpp

BIN_DIR = bin
WEB_DIR = web

TARGET_NATIVE = $(BIN_DIR)/last_magazine.exe
TARGET_WEB = $(WEB_DIR)/index.html

.PHONY: all native web clean

all: native

native: $(TARGET_NATIVE)

$(TARGET_NATIVE): $(SRCS)
	@if not exist $(BIN_DIR) mkdir $(BIN_DIR)
	$(CXX) $(CXXFLAGS) $(SRCS) $(LDFLAGS_NATIVE) -o $(TARGET_NATIVE)
	@echo [BUILD SUCCESS] Native build complete: $(TARGET_NATIVE)

web: $(TARGET_WEB)

$(TARGET_WEB): $(SRCS) web/shell.html
	@if not exist $(WEB_DIR) mkdir $(WEB_DIR)
	$(EMCC) -std=c++17 -O3 -Isrc -Isrc/vendor \
		-sUSE_SDL=2 \
		-sMIN_WEBGL_VERSION=2 \
		-sMAX_WEBGL_VERSION=2 \
		-sALLOW_MEMORY_GROWTH=1 \
		--preload-file assets \
		--shell-file web/shell.html \
		$(SRCS) \
		-o $(TARGET_WEB)
	@echo [BUILD SUCCESS] WebAssembly build complete: $(TARGET_WEB)

clean:
	@if exist $(BIN_DIR) rmdir /s /q $(BIN_DIR)
	@if exist $(WEB_DIR)\index.html del /f /q $(WEB_DIR)\index.html $(WEB_DIR)\index.js $(WEB_DIR)\index.wasm $(WEB_DIR)\index.data
