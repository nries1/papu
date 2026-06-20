#ifndef OTA_H
#define OTA_H

#include <ArduinoOTA.h>

namespace OTAService {

inline void begin(const char* hostname) {
  ArduinoOTA.setHostname(hostname);

  ArduinoOTA.onStart([]() {
    Serial.println("[OTA] Starting update");
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("[OTA] Done — rebooting");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] %u%%\n", progress * 100 / total);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] Error[%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.printf("[OTA] Ready — %s.local\n", hostname);
}

inline void handle() {
  ArduinoOTA.handle();
}

}  // namespace OTAService

#endif  // OTA_H
