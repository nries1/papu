#include <Arduino.h>
#include <esp_mac.h>

String getDeviceID() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[9];
  snprintf(id, sizeof(id), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(id);  // e.g. "A1B2C3"
}

void setup() {
  Serial.setDebugOutput(true);
  Serial.begin(115200);

  delay(10000);  // Give the USB driver time to initialize.
  Serial.println("\n\n=====================");
  Serial.println("PORT OPENED SUCCESSFULLY");
  Serial.println("=====================");
  Serial.print("Device ID: ");
  Serial.println(getDeviceID());
}

void loop() {
  // put your main code here, to run repeatedly:
}
