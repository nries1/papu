#include <Arduino.h>
#include "config.h"
#include "device.h"
#include "display.h"
#include "networking.h"
#include "ota.h"
#include "pump.h"
#include "sensor.h"

Networking plantComms;
SensorNode sensorNode;
Display display;
Pump plantPump;
Device device;

void setup() {
  Serial.setDebugOutput(true);

  Serial.begin(115200);

  // CRITICAL: The CLI monitor connects fast.
  // Give the USB driver time to initialize.
  delay(10000);

  Serial.println("\n\n=====================");
  Serial.println("PORT OPENED SUCCESSFULLY");
  Serial.println("=====================");

  char* device_name =
      "office_tower";  // only needed on first upload to set the NVS value, can be left as ""
                            // on subsequent uploads to preserve the name in NVS
  char* room_name = "office";  // only needed on first upload to set the NVS value, can be left
                                    // as "" on subsequent uploads to preserve the room name in NVS
  device.begin(device_name, room_name);
  // Display::begin() will initialize and scan I2C on the Metro pins.

  // Initialize NTP time sync
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println("Calling display.begin()...");
  display.begin();
  Serial.println("Returned from display.begin()");
  plantComms.begin(WIFI_SSID, WIFI_PASS);
  OTAService::begin(Device::getDeviceName().c_str());
  plantPump.begin();
  sensorNode.begin();

  // Subscriber 1: Update the LCD

  sensorNode.subscribe([](float gallons, int rawValue, float percentFull) {
    Serial.println("Callback: sensor reading received — calling display");
    String msg = "Level: " + String(percentFull) + "%";
    display.enqueueUpdate(msg.c_str(), 1);  // Don't call printLine directly
  });

  sensorNode.subscribe([&plantComms](float gallons, int rawValue, float percentFull) {
    Serial.println("Network subscribed to water level sensor events");  // Add this
    plantComms.enqueueWaterLevelEvent(gallons, rawValue, percentFull);
  });

  // subscribe pump.handleWaterPlantsEvent to listen for plantComms events
  plantComms.subscribe([&](float duration, int eventId) {
    Serial.println("Pump node subscribed to MQTT events, received command to water plants");
    plantPump.handleWaterPlantsEvent(duration, eventId);
  });

  plantPump.subscribe([&](float duration, int eventId) {
    Serial.println(
        "Pump node subscribed to MQTT completion events, received notification of pump cycle "
        "complete");
    plantComms.handlePumpCycleComplete(duration, eventId);
  });

  sensorNode.startTask();

  vTaskDelay(pdMS_TO_TICKS(100));  // Let the scheduler settle before setup() exits
}

void loop() {
  OTAService::handle();
  plantComms.maintainConnection(Device::getDeviceID().c_str(), SHARED_TOPIC_PUMP);
  plantComms.flushPendingEvents();
  plantPump.update();
}
