#include <Arduino.h>
#include <WiFi.h>

#include "config.h"

void setup() {
  Serial.begin(115200);
  delay(3000);
  Serial.printf("reset: %d  heap: %lu  cpu: %dMHz\n",
               (int)esp_reset_reason(), (unsigned long)ESP.getFreeHeap(), getCpuFrequencyMhz());
  setCpuFrequencyMhz(80);
  Serial.printf("cpu now: %dMHz\n", getCpuFrequencyMhz());
  Serial.flush();
  Serial.println("WiFi.begin...");
  Serial.flush();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.println("WiFi.begin returned");
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) delay(500);
  if (WiFi.status() == WL_CONNECTED)
    Serial.println("connected: " + WiFi.localIP().toString());
  else
    Serial.println("FAILED");
}

void loop() {}
