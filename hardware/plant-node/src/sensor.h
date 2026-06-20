#ifndef SENSOR_H
#define SENSOR_H

#include <Arduino.h>
#include <esp_task_wdt.h>

#include <algorithm>
#include <functional>
#include <vector>

#include "logger.h"

struct TankReading {
  int rawValue;
  float percent;
  float gallons;
};

// Use a modern using alias instead of typedef
using WaterLevelCallback = std::function<void(float, int, float)>;

class SensorNode {
 private:
  Logger log{"SENSOR"};
  // Explicitly use std:: namespace to be safe
  std::vector<WaterLevelCallback> listeners;
  const uint8_t tankReadPin = A0;
  int rawEmptyValue;
  int rawFullValue;
  const float maxGallons = 30.0;
  // Timing variables
  unsigned long lastReadTime = 0;
  const int numberOfReadings = 51;
  const unsigned long readInterval = 2 * 60 * 1000;  // 2 minutes
  float lastReportedPercentage = -1.0;
  TaskHandle_t TankTask;

 public:
  // Default Constructor for ESP32 (12-bit ADC)
  SensorNode() : rawEmptyValue(0), rawFullValue(3600) {}

  SensorNode(int emptyVal, int fullVal) : rawEmptyValue(emptyVal), rawFullValue(fullVal) {}

  void begin() {
    // First thing — print why we last crashed
    esp_reset_reason_t reason = esp_reset_reason();
    log.info("Last reset reason: %d\n", reason);
    // reason == 3 is SW reset, reason == 11 is task watchdog, reason == 12 is interrupt watchdog

    int rc = xTaskCreatePinnedToCore(this->taskWrapper, "TankTask", 4096, this, 1, &TankTask, 0);

    vTaskSuspend(TankTask);

    if (rc != pdPASS) {
      log.error("SensorNode: failed to create task (%d)\n", rc);
    } else {
      log.info("SensorNode: task created");
    }
  }

  void startTask() {
    vTaskResume(TankTask);
  }

  // Static wrapper that FreeRTOS can understand
  static void taskWrapper(void* pvParameters) {
    SensorNode* instance = (SensorNode*) pvParameters;
    instance->tankMonitorTask();  // Call the actual member function
  }

  void tankMonitorTask() {
    for (;;) {
      // 1. Perform the reading
      TankReading current = readTankLevel();

      log.info("raw=%d pct=%.2f gal=%.2f\n", current.rawValue, current.percent, current.gallons);

      // 2. Check for a significant change (1.5% threshold)
      // This ensures we only notify subscribers if something meaningful happened
      log.info("Prev reported pct=%.2f, current pct=%.2f\n", lastReportedPercentage,
               current.percent);
      log.info("Difference from last reported percentage: %f",
               abs(current.percent - lastReportedPercentage));
      if (abs(current.percent - lastReportedPercentage) >= 1.5) {
        log.info("Notifying %d subscribers\n", listeners.size());
        lastReportedPercentage = current.percent;
        log.info("Tank Task: Change detected. Notifying subscribers.");
        for (int i = 0; i < listeners.size(); i++) {
          log.info("  Calling listener %d\n", i);
          if (listeners[i]) {
            listeners[i](current.gallons, current.rawValue, current.percent);
          } else {
            log.info("  Listener %d is null!\n", i);
          }
        }

      } else {
        log.info("Tank Task: No significant change. Standing by.");
      }

      // 3. Yield CPU for configured read interval
      vTaskDelay(pdMS_TO_TICKS(readInterval));
    }
  }
  // Ensure the argument here matches the using alias exactly
  void subscribe(WaterLevelCallback cb) {
    listeners.push_back(cb);
  }

  TankReading readTankLevel() {
    log.info("Reading tank level...");
    int rawValue = getMedianTankLevel();

    log.info("Raw sensor value: %d\n", rawValue);

    // 3. Calculate percentage using your calibrated "Zero" and "Full" points
    float percentage =
        (float) (rawValue - rawEmptyValue) * 100.0 / (float) (rawFullValue - rawEmptyValue);
    percentage = constrain(percentage, 0.0, 100.0);

    log.info("Calculated percentage: %.2f%%", percentage);
    // 4. Calculate gallons (based on your 30-gallon total)
    float gallons = (percentage / 100.0) * maxGallons;

    log.info("Calculated gallons: %.2f", gallons);
    // Return the averaged data as an object
    return {rawValue, percentage, gallons};
  }

  int getMedianTankLevel() {
    log.info("Gathering multiple samples for median filtering...\n");
    int samples[numberOfReadings];

    // Gather samples
    for (int i = 0; i < numberOfReadings; i++) {
      samples[i] = analogRead(tankReadPin);
      log.info("  sample[%d] = %d\n", i, samples[i]);
      vTaskDelay(pdMS_TO_TICKS(20));
    }
    log.info("Samples collected:");
    log.info("Sorting samples to find median...");

    // Sort the samples using the standard library
    std::sort(samples, samples + numberOfReadings);

    // Return the middle value (the median)
    return samples[numberOfReadings / 2];
  }
};

#endif
