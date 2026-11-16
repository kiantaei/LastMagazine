#pragma once

#include <string>
#include <iostream>
#include <sstream>

namespace engine::core {

enum class LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Critical
};

class Logger {
public:
    static void log(LogLevel level, const std::string& category, const std::string& message);

    static void trace(const std::string& category, const std::string& message) {
        log(LogLevel::Trace, category, message);
    }

    static void debug(const std::string& category, const std::string& message) {
        log(LogLevel::Debug, category, message);
    }

    static void info(const std::string& category, const std::string& message) {
        log(LogLevel::Info, category, message);
    }

    static void warn(const std::string& category, const std::string& message) {
        log(LogLevel::Warn, category, message);
    }

    static void error(const std::string& category, const std::string& message) {
        log(LogLevel::Error, category, message);
    }

    static void critical(const std::string& category, const std::string& message) {
        log(LogLevel::Critical, category, message);
    }
};

} // namespace engine::core
