#include "logger.h"

#include <cstdlib>
#include <filesystem>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>

namespace fs = std::filesystem;

namespace codesage {

std::shared_ptr<spdlog::logger> Logger::logger_;

void Logger::init(const std::string& log_dir, spdlog::level::level_enum level) {
    std::vector<spdlog::sink_ptr> sinks;

    auto console_sink = std::make_shared<spdlog::sinks::stderr_color_sink_mt>();
    console_sink->set_level(spdlog::level::info);
    sinks.push_back(console_sink);

    std::string dir = log_dir;
    if (dir.empty()) {
        const char* home = std::getenv("HOME");
        if (home) {
            dir = std::string(home) + "/.codesage/logs";
        }
    }

    if (!dir.empty()) {
        fs::create_directories(dir);
        auto file_sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            dir + "/analyzer.log", 10 * 1024 * 1024, 5);
        file_sink->set_level(spdlog::level::debug);
        sinks.push_back(file_sink);
    }

    logger_ = std::make_shared<spdlog::logger>("codesage", sinks.begin(), sinks.end());
    logger_->set_level(level);
    logger_->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] [%s:%#] %v");
    logger_->flush_on(spdlog::level::warn);

    spdlog::set_default_logger(logger_);
    CS_INFO("Logger initialized, log_dir={}", dir);
}

void Logger::shutdown() {
    CS_INFO("Logger shutting down");
    spdlog::shutdown();
}

std::shared_ptr<spdlog::logger>& Logger::get() {
    if (!logger_) {
        init();
    }
    return logger_;
}

}  // namespace codesage
