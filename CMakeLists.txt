cmake_minimum_required(VERSION 3.16)
project(LastMagazine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/vendor
)

set(SOURCES
    src/main.cpp
    src/engine/core/logger.cpp
    src/engine/core/time.cpp
    src/engine/core/window.cpp
    src/engine/input/input_manager.cpp
    src/engine/audio/audio_system.cpp
    src/engine/renderer/gl_loader.cpp
    src/engine/renderer/shader.cpp
    src/game/game_app.cpp
)

if(EMSCRIPTEN)
    add_executable(last_magazine ${SOURCES})
    set_target_properties(last_magazine PROPERTIES
        OUTPUT_NAME "index"
        SUFFIX ".html"
    )

    target_compile_options(last_magazine PRIVATE -O3)
    target_link_options(last_magazine PRIVATE
        -O3
        -sUSE_SDL=2
        -sMIN_WEBGL_VERSION=2
        -sMAX_WEBGL_VERSION=2
        -sALLOW_MEMORY_GROWTH=1
        --preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@assets
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']
    )
else()
    add_executable(last_magazine ${SOURCES})

    if(WIN32)
        target_link_libraries(last_magazine PRIVATE
            mingw32
            SDL2main
            SDL2
            opengl32
        )
    else()
        find_package(SDL2 REQUIRED)
        find_package(OpenGL REQUIRED)
        target_link_libraries(last_magazine PRIVATE
            SDL2::SDL2
            OpenGL::GL
        )
    endif()
endif()
