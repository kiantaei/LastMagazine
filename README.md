# IRON HORIZON — Native C++ Vulkan Simulator

Combined-arms flight simulator, ported from the original WebGL/three.js
prototype to a native C++20 application with a raw Vulkan renderer
(no OpenGL, no WebGL, no browser).

## Building

Requirements: CMake ≥ 3.20, a C++20 compiler, the Vulkan SDK (headers and
`glslangValidator`), GLFW 3.3+, GLM.

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./build/ironhorizon   # shaders/*.spv are built next to it
```

## Controls

| Key | Action |
| --- | --- |
| W / S | Pitch down / up |
| A / D | Roll left / right (banked turn) |
| Q / E | Yaw |
| Shift / Ctrl | Throttle up / down |
| Esc | Quit |

## Releases

Pushing a tag `v*` or publishing a GitHub release triggers
`.github/workflows/release.yml`, which builds Linux and Windows binaries and
attaches `ironhorizon-<os>.zip` (binary + compiled shaders) to the release.

## Layout

- `native/src/vk_renderer.*` — Vulkan: instance, swapchain, pipeline, frames in flight, resize handling
- `native/src/world.*` — terrain mesh, jet mesh, arcade flight model
- `native/src/main.cpp` — window, input, chase camera, frame loop
- `native/shaders/` — GLSL, compiled to SPIR-V at build time

The earlier WebGL/three.js version was removed in the port; recover it from
git history (commits before `native-vulkan-port`) if needed.
