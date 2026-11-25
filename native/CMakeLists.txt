cmake_minimum_required(VERSION 3.20)
project(ironhorizon LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Vulkan REQUIRED)
find_package(glfw3 3.3 REQUIRED)

add_executable(ironhorizon
    src/main.cpp
    src/vk_renderer.cpp
    src/world.cpp
)
target_link_libraries(ironhorizon PRIVATE Vulkan::Vulkan glfw)

if(GLM_INCLUDE_DIR)
    target_include_directories(ironhorizon PRIVATE ${GLM_INCLUDE_DIR})
else()
    find_package(glm QUIET)
    find_path(GLM_PATH glm/glm.hpp)
    if(GLM_PATH)
        target_include_directories(ironhorizon PRIVATE ${GLM_PATH})
    endif()
endif()
if(WIN32)
    target_link_libraries(ironhorizon PRIVATE opengl32)  # glfw surface ext
else()
    find_package(Threads REQUIRED)
    target_link_libraries(ironhorizon PRIVATE Threads::Threads dl)
endif()

# --- Shaders: compile GLSL to SPIR-V at build time ---
find_program(GLSLANG_VALIDATOR glslangValidator
             HINTS "$ENV{VULKAN_SDK}/bin" "$ENV{VULKAN_SDK}/Bin")
if(NOT GLSLANG_VALIDATOR)
    message(FATAL_ERROR "glslangValidator not found — install vulkan-sdk / glslang-tools")
endif()

file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/shaders)
set(SPIRV_OUT)
foreach(SHADER tri.vert tri.frag)
    set(SRC ${CMAKE_CURRENT_SOURCE_DIR}/shaders/${SHADER})
    set(OUT ${CMAKE_CURRENT_BINARY_DIR}/shaders/${SHADER}.spv)
    add_custom_command(
        OUTPUT ${OUT}
        COMMAND ${GLSLANG_VALIDATOR} -V ${SRC} -o ${OUT}
        DEPENDS ${SRC}
        COMMENT "glslangValidator ${SHADER}")
    list(APPEND SPIRV_OUT ${OUT})
endforeach()
add_custom_target(shaders ALL DEPENDS ${SPIRV_OUT})
add_dependencies(ironhorizon shaders)
