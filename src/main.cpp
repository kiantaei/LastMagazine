#include "game/game_app.h"
#include "engine/core/logger.h"

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>

static void emscripten_frame_callback(void* arg) {
    auto* app = static_cast<game::GameApp*>(arg);
    if (app && app->is_running()) {
        app->step_frame();
    }
}
#endif

int main(int argc, char* argv[]) {
    game::GameApp app;

    if (!app.init()) {
        engine::core::Logger::critical("MAIN", "Engine initialization failed. Aborting.");
        return 1;
    }

#if defined(__EMSCRIPTEN__)
    engine::core::Logger::info("MAIN", "Registering Emscripten main loop callback...");
    // 0 fps = requestAnimationFrame, 1 = simulate infinite loop
    emscripten_set_main_loop_arg(emscripten_frame_callback, &app, 0, 1);
#else
    engine::core::Logger::info("MAIN", "Entering native game loop...");
    while (app.is_running()) {
        app.step_frame();
    }
    app.shutdown();
#endif

    return 0;
}
