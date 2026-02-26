#pragma once

#include <string>
#include <memory>
#include <spdlog/spdlog.h>

namespace codesage {

class Logger {
public:
    static void init(const std::string& log_dir = "",
                     spdlog::level::level_enum level = spdlog::level::info);
    static void shutdown();

    static std::shared_ptr<spdlog::logger>& get();

private:
    static std::shared_ptr<spdlog::logger> logger_;
};

#define CS_TRACE(...)  SPDLOG_LOGGER_TRACE(codesage::Logger::get(), __VA_ARGS__)
#define CS_DEBUG(...)  SPDLOG_LOGGER_DEBUG(codesage::Logger::get(), __VA_ARGS__)
#define CS_INFO(...)   SPDLOG_LOGGER_INFO(codesage::Logger::get(), __VA_ARGS__)
#define CS_WARN(...)   SPDLOG_LOGGER_WARN(codesage::Logger::get(), __VA_ARGS__)
#define CS_ERROR(...)  SPDLOG_LOGGER_ERROR(codesage::Logger::get(), __VA_ARGS__)
#define CS_CRITICAL(...) SPDLOG_LOGGER_CRITICAL(codesage::Logger::get(), __VA_ARGS__)

}  // namespace codesage
