#ifndef LOGGER_H
#define LOGGER_H

#include <Arduino.h>
#include <TelnetStream.h>

enum LogLevel { LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR };

class Logger {
 private:
  const char* _tag;
  static unsigned long startTime;
  static bool initialized;

 public:
  Logger(const char* tag) : _tag(tag) {}

  static void begin() {
    startTime = millis();
    initialized = true;
  }

  void log(LogLevel level, const char* fmt, ...) const {
    float elapsed = (millis() - startTime) / 1000.0f;

    const char* levelStr;
    switch (level) {
      case LOG_DEBUG:
        levelStr = "DEBUG";
        break;
      case LOG_INFO:
        levelStr = "INFO ";
        break;
      case LOG_WARN:
        levelStr = "WARN ";
        break;
      case LOG_ERROR:
        levelStr = "ERROR";
        break;
    }

    char msg[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);

    char line[320];
    snprintf(line, sizeof(line), "[%7.3fs] [%s /%-7s] %s\n", elapsed, levelStr, _tag, msg);
    Serial.print(line);
    TelnetStream.print(line);
  }

  void debug(const char* fmt, ...) const {
    va_list args;
    va_start(args, fmt);
    char msg[256];
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);
    log(LOG_DEBUG, "%s", msg);
  }
  void info(const char* fmt, ...) const {
    va_list args;
    va_start(args, fmt);
    char msg[256];
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);
    log(LOG_INFO, "%s", msg);
  }
  void warn(const char* fmt, ...) const {
    va_list args;
    va_start(args, fmt);
    char msg[256];
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);
    log(LOG_WARN, "%s", msg);
  }
  void error(const char* fmt, ...) const {
    va_list args;
    va_start(args, fmt);
    char msg[256];
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);
    log(LOG_ERROR, "%s", msg);
  }
};

unsigned long Logger::startTime = 0;
bool Logger::initialized = false;

#endif
