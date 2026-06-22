#ifndef NETWORKING_H
#define NETWORKING_H

#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include <functional>
#include <vector>

#include "device.h"
#include "logger.h"
#include "shared_constants.h"

using PumpEvent = std::function<void(int, int)>;

class Networking {
 private:
  Logger log{"NETWORK"};
  WiFiClient espClient;
  PubSubClient client;
  const char* _ssid;
  const char* _password;
  unsigned long lastTankUpdate = 0;
  const unsigned long tankUpdateInterval = 60000;
  std::vector<PumpEvent> listeners;
  float pendingGallons;
  int pendingRawValue;
  float pendingPercent;
  volatile bool hasPendingWaterLevel = false;
  Device device;

  // A static pointer to "this" instance so the static callback can find the object
  static Networking* instance;

 public:
  // Constructor
  Networking() : client(espClient) {}

  void begin(const char* ssid, const char* password) {
    instance = this;  // Store the instance
    _ssid = ssid;
    _password = password;
    setupWifi();
    setupPubSub();
  }

  // MUST be static to satisfy PubSubClient
  static void mqttCallback(char* topic, byte* payload, unsigned int length) {
    if (instance) {
      instance->publishWaterLevelEvent(topic, payload, length);
    }
  }

  void subscribe(PumpEvent cb) {
    listeners.push_back(cb);
  }

  void publishBootEvent() {
    JsonDocument doc;
    char buf[200];
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["ip"] = WiFi.localIP().toString();
    serializeJson(doc, buf);
    client.publish(SHARED_TOPIC_DEVICE_BOOT, buf);
  }

  void publishLog(const char* level, const char* message) {
    if (!client.connected()) return;
    JsonDocument doc;
    char out[320];
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["log_level"] = level;
    doc["message"] = message;
    serializeJson(doc, out);
    client.publish(SHARED_TOPIC_DEVICE_LOGS, out);
  }

  void handlePumpCycleComplete(int duration, int eventId) {
    JsonDocument response;
    response["event_id"] = eventId;
    response["status"] = SHARED_STATUS_COMPLETE;
    response["duration"] = duration;

    char buffer[256];
    serializeJson(response, buffer);
    log.info("Publishing handlePumpCycleComplete event");
    log.info("Topic: %s", SHARED_TOPIC_PUMP_CYCLE_COMPLETE);
    client.publish(SHARED_TOPIC_PUMP_CYCLE_COMPLETE, buffer);
  }

  void publishWaterLevelEvent(char* topic, byte* payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
      log.info("JSON Parse failed: %s", error.c_str());
      return;
    }

    const char* action = doc["action"];
    int eventId = doc["event_id"] | 0;
    int duration = doc["duration_ms"].is<int>() ? doc["duration_ms"].as<int>() : 3000;

    // We no longer check sensorNode here.
    // We just emit the event if the action matches.
    if (action && strcmp(action, SHARED_ACTION_WATER_ON) == 0) {
      log.info("MQTT Command Received: %s (ID: %d, duration_ms: %d)", action, eventId, duration);

      for (auto& cb : listeners) {
        if (cb)
          cb(duration, eventId);
      }
    }
  }

  void setupWifi() {
    delay(10);
    log.info("Connecting to %s", _ssid);
    WiFi.begin(_ssid, _password);

    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    log.info("\nWiFi connected");
  }

  void setupPubSub() {
    client.setServer(MQTT_HOST, 1883);
    client.setCallback(mqttCallback);
  }

  void maintainConnection(const char* clientId, const char* topic) {
    // If WiFi is down, loop() and connected() won't work right
    if (WiFi.status() != WL_CONNECTED) {
      setupWifi();
    }

    if (!client.connected()) {
      log.info("MQTT Disconnected on device %s. Attempting reconnection...", clientId);
      if (client.connect(clientId)) {
        log.info("connected");
        // IMPORTANT: You MUST re-subscribe every time you reconnect
        // because the broker "forgot" your subscriptions when it restarted
        String resolvedTopic = String(topic); resolvedTopic.replace("{device_id}", clientId); client.subscribe(resolvedTopic.c_str());
        log.info("Re-subscribed to: %s", topic);
        publishLog("info", "Device startup complete");
        publishBootEvent();
      } else {
        log.info("failed, rc=%d", client.state());
        publishLog("error", "MQTT connection failed");
        delay(5000);
      }
    }
    client.loop();
  }

  void handlePublishWaterLevelEvent(float gallons, int rawValue, float percentFull) {
    if (!client.connected()) {
      log.info("MQTT publish skipped — client not connected");
      return;
    }
    JsonDocument doc;
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();  // e.g. "living_room"
    doc["tank_gallons"] = gallons;
    doc["percent_full"] = percentFull;
    doc["raw_value"] = rawValue;

    char buffer[256];
    serializeJson(doc, buffer);
    log.info("Publishing water level reading event");
    log.info("Topic: %s", SHARED_TOPIC_WATER_LEVEL);
    bool success = client.publish(SHARED_TOPIC_WATER_LEVEL, buffer);
    log.info("Publish to %s: %s", SHARED_TOPIC_WATER_LEVEL, success ? "OK" : "FAILED");
    if (!success) {
      publishLog("error", "Failed to publish water level reading");
    }
  }

  void enqueueWaterLevelEvent(float gallons, int rawValue, float percentFull) {
    log.info("enqueueWaterLevelEvent called");
    pendingGallons = gallons;
    pendingRawValue = rawValue;
    pendingPercent = percentFull;
    hasPendingWaterLevel = true;  // Signal the main loop
  }

  void flushPendingEvents() {
    if (hasPendingWaterLevel && client.connected()) {
      hasPendingWaterLevel = false;
      handlePublishWaterLevelEvent(pendingGallons, pendingRawValue, pendingPercent);
    }
  }
};

Networking* Networking::instance = nullptr;

#endif
