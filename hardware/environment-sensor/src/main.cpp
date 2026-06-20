#include <Arduino.h>
#include <Adafruit_BME680.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>

#include "config.h"            // Provides WIFI_SSID, WIFI_PASS, MQTT_HOST
#include "device.h"
#include "ota.h"
#include "shared_constants.h"  // Shared topic names

// MQTT Topics (use shared definitions when available)
const char* topicTemp = SHARED_TOPIC_TEMP_1F;
const char* topicHumidity = SHARED_TOPIC_HUMIDITY_1F;
const char* topicPressure = SHARED_TOPIC_PRESSURE_1F;
const char* topicGas = SHARED_TOPIC_GAS_1F;

// --- Hardware & Timing ---
#define I2C_SDA 8
#define I2C_SCL 9

Adafruit_BME680 bme;
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Device device;

String clientId = Device::getDeviceID();
unsigned long lastMsgTime = 0;
const unsigned long interval = 3600000;  // Sample and publish every 1 hour

// Reference resistance in clean indoor air (KΩ). After the sensor runs 30+ min in fresh air,
// note its stable value and update this constant for better IAQ accuracy.
#define GAS_REFERENCE_KOHM 75.0

// --- Functions ---

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

  float airQualityPct = humScore + gasScore;  // 0–100%, higher = better air
  return constrain((100.0 - airQualityPct) * 5.0, 0.0, 500.0);
}

void publishLog(const char* level, const char* message) {
  if (!mqttClient.connected())
    return;
  StaticJsonDocument<256> doc;
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
  Serial.println();
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

void maintainMQTTConnection() {
  // Loop until we are reconnected to the broker
  while (!mqttClient.connected()) {
    Serial.print("Attempting MQTT connection as ");
    Serial.print(clientId);
    Serial.print("...");

    // Connect to the broker
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" connected successfully!");
    } else {
      Serial.print(" failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(". Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  delay(10000);  // Give serial monitor time to catch up
  Serial.println("--- ESP32-C3 BME680 Node Starting ---");
  char* device_name =
      "living_room_env_sensor";  // only needed on first upload to set the NVS value, can be left as ""
                            // on subsequent uploads to preserve the name in NVS
  char* room_name = "living_room";  // only needed on first upload to set the NVS value, can be left
                               // as "" on subsequent uploads to preserve the room name in NVS
  device.begin(device_name, room_name);

  // Force I2C initialization on the ESP32-C3 Super Mini dedicated pins
  Wire.begin(I2C_SDA, I2C_SCL);

  // Initialize BME680 (0x77 is default for Adafruit breakouts; if it fails try 0x76)
  // Diagnostic: scan the I2C bus and try both common BME680 addresses
  Serial.println("Scanning I2C bus for devices...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" - Found device at 0x%02X\n", addr);
    }
  }

  bool found = false;
  const uint8_t candidates[] = {0x77, 0x76};
  for (uint8_t i = 0; i < sizeof(candidates); i++) {
    uint8_t a = candidates[i];
    Serial.printf("Trying BME680 at 0x%02X...\n", a);
    if (bme.begin(a)) {
      Serial.printf("BME680 initialized at 0x%02X\n", a);
      found = true;
      break;
    } else {
      Serial.printf("No BME680 at 0x%02X\n", a);
    }
    delay(200);
  }

  if (!found) {
    Serial.println(
        "Could not find a valid BME680 sensor, check wiring, power (3.3V), and SDA/SCL pins.");
    Serial.println(
        "Tips: ensure breakout is powered at 3.3V (not 5V), pull-ups are present, and try swapping "
        "SDA/SCL.");
    while (1) {
      delay(1000);
    }
  }

  // Set up oversampling and filter configurations for the BME680 gas readings
  bme.setTemperatureOversampling(BME680_OS_8X);
  bme.setHumidityOversampling(BME680_OS_2X);
  bme.setPressureOversampling(BME680_OS_4X);
  bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
  bme.setGasHeater(320, 150);  // 320°C for 150 ms to burn off volatile compounds for VOC reading

  setupWiFi();
  OTAService::begin(Device::getDeviceName().c_str());
  // Use shared MQTT host (default port 1883)
  mqttClient.setServer(MQTT_HOST, 1883);
  lastMsgTime = millis() - interval;  // trigger first reading immediately on boot
  maintainMQTTConnection();
  publishLog("info", "Device startup complete");
}

void loop() {
  OTAService::handle();
  // Ensure the networking layer stays alive
  if (!mqttClient.connected()) {
    maintainMQTTConnection();
  }
  mqttClient.loop();

  // Non-blocking timer for reading the sensor environment
  unsigned long now = millis();
  if (now - lastMsgTime >= interval) {
    lastMsgTime = now;

    // Tell the BME680 to begin an asynchronous reading
    if (!bme.performReading()) {
      Serial.println("Failed to perform BME680 sensor reading :(");
      publishLog("error", "Failed to perform BME680 sensor reading");
      return;
    }

    // Extract metrics
    float tempC = bme.temperature;
    float tempF =
        (tempC * 9.0 / 5.0) + 32.0;  // Conversion helper if your dashboard reads Fahrenheit
    float humidity = bme.humidity;
    float pressure = bme.pressure / 100.0;  // Convert Pascals to hPa / millibars
    float gasResis =
        bme.gas_resistance / 1000.0;  // Convert ohms to K-ohms (Air Quality indication)
    float iaq = computeIAQ(gasResis, humidity);

    // Log values locally to Serial for testing/debugging
    Serial.printf(
        "\n--- Data Read ---\nTemp: %.2f °F | Humid: %.2f %% | Press: %.2f hPa | Gas: %.2f KΩ | IAQ: %.1f\n",
        tempF, humidity, pressure, gasResis, iaq);

    // Build JSON payloads and publish (include device and room info)
    StaticJsonDocument<192> doc;
    char out[256];

    // Temperature (F)
    doc.clear();
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();  // device-specific name (unique)
    doc["room"] = Device::getFriendlyRoomName();   // e.g. "living_room"
    doc["metric"] = "temperature_f";
    doc["value"] = tempF;
    serializeJson(doc, out);
    mqttClient.publish(topicTemp, out);

    doc.clear();
    // Humidity (%)
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();  // e.g. "living_room"
    doc["metric"] = "humidity_pct";
    doc["value"] = humidity;
    serializeJson(doc, out);
    mqttClient.publish(topicHumidity, out);

    doc.clear();
    // Pressure (hPa)
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();  // e.g. "living_room"
    doc["metric"] = "pressure_hpa";
    doc["value"] = pressure;
    serializeJson(doc, out);
    mqttClient.publish(topicPressure, out);

    doc.clear();
    // IAQ index (0=excellent, 500=extremely polluted)
    doc["device_id"] = Device::getDeviceID();
    doc["device_name"] = Device::getDeviceName();
    doc["room"] = Device::getFriendlyRoomName();  // e.g. "living_room"
    doc["metric"] = "iaq";
    doc["value"] = iaq;
    serializeJson(doc, out);
    mqttClient.publish(topicGas, out);

    Serial.println("Metrics dispatched to home-server successfully.");
  }
}
