#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(1000);  // give the USB CDC port a moment to enumerate
  Serial.println();
  Serial.println("Upload worked! ESP32-S3 is alive.");
}

void loop() {
  static uint32_t n = 0;
  Serial.printf("heartbeat: %lu\n", n++);
#ifdef RGB_BUILTIN
  neopixelWrite(RGB_BUILTIN, (n & 1) ? 20 : 0, 0, (n & 1) ? 0 : 20);  // dim blue/off
#endif
  delay(1000);
}
