#include "logger.h"
#include <SDL2/SDL.h>
#include <iomanip>

namespace engine::core {

void Logger::log(LogLevel level, const std::string& category, const std::string& message) {
    const char* level_str = "INFO";
    const char* color_code = "\033[0m"; // Reset

    switch (level) {
        case LogLevel::Trace:
            level_str = "TRACE";
            color_code = "\033[90m"; // Gray
            break;
        case LogLevel::Debug:
            level_str = "DEBUG";
            color_code = "\033[36m"; // Cyan
            break;
        case LogLevel::Info:
            level_str = "INFO";
            color_code = "\033[32m"; // Green
            break;
        case LogLevel::Warn:
            level_str = "WARN";
            color_code = "\033[33m"; // Yellow
            break;
        case LogLevel::Error:
            level_str = "ERROR";
            color_code = "\033[31m"; // Red
            break;
        case LogLevel::Critical:
            level_str = "CRIT";
            color_code = "\033[41;97m"; // White on Red
            break;
    }

    uint32_t ticks = SDL_GetTicks();
    uint32_t sec = ticks / 1000;
    uint32_t ms = ticks % 1000;

#ifdef __EMSCRIPTEN__
    // In browser console, stdout/stderr print cleanly to JS devtools console
    std::cout << "[" << std::setfill('0') << std::setw(3) << sec << "."
              << std::setfill('0') << std::setw(3) << ms << "]"
              << "[" << category << "][" << level_str << "] " << message << std::endl;
#else
    // Desktop ANSI terminal formatting
    std::cout << color_code << "[" << std::setfill('0') << std::setw(3) << sec << "."
              << std::setfill('0') << std::setw(3) << ms << "]"
              << "[" << category << "][" << level_str << "] " << message << "\033[0m" << std::endl;
#endif
}

} // namespace engine::core
