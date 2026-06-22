#include <Arduino.h>
#include "config.h"
#include "device.h"
#include "display.h"
#include "networking.h"
#include "ota.h"
#include "pump.h"
#include "sensor.h"

// --- Device identity -------------------------------------------------------
// Overridden at flash time via flash.js --name / --room build flags; --name also
// sets the OTA host (<name>.local). Defaults preserve the original values.
#define STRINGIFY(x) #x
#define TO_STRING(x) STRINGIFY(x)

#ifndef DEVICE_NAME
#define DEVICE_NAME office_tower
#endif
#ifndef ROOM_NAME
#define ROOM_NAME office
#endif

Networking plantComms;
SensorNode sensorNode;
Display display;
Pump plantPump;
Device device;

void setup() {
  Serial.setDebugOutput(true);
  Serial.begin(115200);

  // On native USB CDC, wait up to 5s for a host to open the port before
  // proceeding. Prevents output from being dropped when the CDC connection
  // isn't ready yet. Falls through after 5s so deployed devices don't hang.
  unsigned long t = millis();
  while (!Serial && millis() - t < 5000) delay(10);

  Serial.println("\n\n=====================");
  Serial.println("PORT OPENED SUCCESSFULLY");
  Serial.println("=====================");

  const char* device_name = TO_STRING(DEVICE_NAME);  // set via flash.js --name (default: office_tower)
  const char* room_name = TO_STRING(ROOM_NAME);      // set via flash.js --room (default: office)
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
