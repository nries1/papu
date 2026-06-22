#include <Arduino.h>
#include <Adafruit_BME680.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>

#include "config.h"
#include "device.h"
#include "logger.h"
#include "ota.h"
#include "shared_constants.h"

// --- Device identity -------------------------------------------------------
// Overridden at flash time by flash.js via --name / --room build flags, e.g.
//   npm run env:upload -- --name office_env_sensor --room office
// The compiled value is written to NVS on every boot and also becomes the
// mDNS/OTA hostname (<name>.local). Defaults apply if none are supplied.
#define STRINGIFY(x) #x
#define TO_STRING(x) STRINGIFY(x)

#ifndef DEVICE_NAME
#define DEVICE_NAME env_sensor
#endif
#ifndef ROOM_NAME
#define ROOM_NAME unknown
#endif

const char* topicTemp = SHARED_TOPIC_TEMP_1F;
const char* topicHumidity = SHARED_TOPIC_HUMIDITY_1F;
const char* topicPressure = SHARED_TOPIC_PRESSURE_1F;
const char* topicGas = SHARED_TOPIC_GAS_1F;

#define I2C_SDA 8
#define I2C_SCL 9

Adafruit_BME680 bme;
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Device device;
Logger logger{"ENV"};

String clientId = Device::getDeviceID();
unsigned long lastMsgTime = 0;
const unsigned long interval = 3600000;

// Reference resistance in clean indoor air (KΩ). After the sensor runs 30+ min in fresh air,
// note its stable value and update this constant for better IAQ accuracy.
#define GAS_REFERENCE_KOHM 75.0

// Returns an IAQ index (0–500, lower is better) using humidity-compensated gas resistance.
// Humidity contributes 25 pts (ideal ~40% RH); gas resistance contributes 75 pts.
float computeIAQ(float gasKohm, float humidity) {
  float humScore;
  if (humidity <= 40.0) {
    humScore = (humidity / 40.0) * 25.0;
  } else {
    humScore = ((100.0 - humidity) / 60.0) * 25.0;
  }
  humScore = constrain(humScore, 0.0, 25.0);

  float gasScore = constrain(gasKohm / GAS_REFERENCE_KOHM, 0.0, 1.0) * 75.0;

  float airQualityPct = humScore + gasScore;
  return constrain((100.0 - airQualityPct) * 5.0, 0.0, 500.0);
}

void publishLog(const char* level, const char* message) {
  if (!mqttClient.connected()) return;
  JsonDocument doc;
  char out[320];
  doc["device_id"] = Device::getDeviceID();
  doc["device_name"] = Device::getDeviceName();
  doc["log_level"] = level;
  doc["message"] = message;
  serializeJson(doc, out);
  mqttClient.publish(SHARED_TOPIC_DEVICE_LOGS, out);
}

void setupWiFi() {
  delay(10);
  logger.info("Connecting to Wi-Fi: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  logger.info("Wi-Fi connected, IP: %s", WiFi.localIP().toString().c_str());
}

void maintainMQTTConnection() {
  while (!mqttClient.connected()) {
    logger.info("Attempting MQTT connection as %s...", clientId.c_str());
    if (mqttClient.connect(clientId.c_str())) {
      logger.info("MQTT connected");
    } else {
      logger.warn("MQTT failed, rc=%d. Retrying in 5s...", mqttClient.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  unsigned long t = millis();
  while (!Serial && millis() - t < 5000) delay(10);

  logger.info("ESP32-C3 BME680 Node Starting");

  const char* device_name = TO_STRING(DEVICE_NAME);  // set via flash.js --name (default: env_sensor)
  const char* room_name = TO_STRING(ROOM_NAME);      // set via flash.js --room (default: unknown)
  device.begin(device_name, room_name);

  Wire.begin(I2C_SDA, I2C_SCL);

  logger.info("Scanning I2C bus...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      logger.info("Found I2C device at 0x%02X", addr);
    }
  }

  bool found = false;
  const uint8_t candidates[] = {0x77, 0x76};
  for (uint8_t i = 0; i < sizeof(candidates); i++) {
    uint8_t a = candidates[i];
    logger.info("Trying BME680 at 0x%02X", a);
    if (bme.begin(a)) {
      logger.info("BME680 initialized at 0x%02X", a);
      found = true;
      break;
    } else {
      logger.warn("No BME680 at 0x%02X", a);
    }
    delay(200);
  }

  if (!found) {
    logger.error("Could not find BME680 — check wiring, power (3.3V), SDA/SCL pins");
    while (1) { delay(1000); }
  }

  bme.setTemperatureOversampling(BME680_OS_8X);
  bme.setHumidityOversampling(BME680_OS_2X);
  bme.setPressureOversampling(BME680_OS_4X);
  bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
  bme.setGasHeater(320, 150);  // 320°C for 150 ms to burn off volatile compounds for VOC reading

  setupWiFi();
  OTAService::begin(Device::getDeviceName().c_str());
  mqttClient.setServer(MQTT_HOST, 1883);
  lastMsgTime = millis() - interval;  // trigger first reading immediately on boot
  maintainMQTTConnection();
  publishLog("info", "Device startup complete");

  {
    JsonDocument bootDoc;
    char bootMsg[200];
    bootDoc["device_id"] = Device::getDeviceID();
    bootDoc["device_name"] = Device::getDeviceName();
    bootDoc["ip"] = WiFi.localIP().toString();
    serializeJson(bootDoc, bootMsg);
    mqttClient.publish(SHARED_TOPIC_DEVICE_BOOT, bootMsg);
  }
}

void loop() {
  OTAService::handle();
  if (!mqttClient.connected()) {
    maintainMQTTConnection();
  }
  mqttClient.loop();

  unsigned long now = millis();
  if (now - lastMsgTime >= interval) {
    lastMsgTime = now;

    if (!bme.performReading()) {
      logger.error("Failed to perform BME680 reading");
      publishLog("error", "Failed to perform BME680 sensor reading");
      return;
    }

    float tempC = bme.temperature;
    float tempF = (tempC * 9.0 / 5.0) + 32.0;
    float humidity = bme.humidity;
    float pressure = bme.pressure / 100.0;
    float gasResis = bme.gas_resistance / 1000.0;
    float iaq = computeIAQ(gasResis, humidity);

    logger.info("Temp: %.2fF | Humid: %.2f%% | Press: %.2f hPa | Gas: %.2f KΩ | IAQ: %.1f",
             tempF, humidity, pressure, gasResis, iaq);

    JsonDocument doc;
    char out[256];

    doc.clear();
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();
    doc["metric"] = "temperature_f";
    doc["value"] = tempF;
    serializeJson(doc, out);
    mqttClient.publish(topicTemp, out);

    doc.clear();
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();
    doc["metric"] = "humidity_pct";
    doc["value"] = humidity;
    serializeJson(doc, out);
    mqttClient.publish(topicHumidity, out);

    doc.clear();
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();
    doc["metric"] = "pressure_hpa";
    doc["value"] = pressure;
    serializeJson(doc, out);
    mqttClient.publish(topicPressure, out);

    doc.clear();
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();
    doc["metric"] = "iaq";
    doc["value"] = iaq;
    serializeJson(doc, out);
    mqttClient.publish(topicGas, out);

    logger.info("Metrics dispatched");
  }
}
