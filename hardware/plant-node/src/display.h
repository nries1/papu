#ifndef DISPLAY_H
#define DISPLAY_H

#include <LiquidCrystal_I2C.h>
#include <Wire.h>

#include "logger.h"
// Matches your PostgreSQL hardware_releases entry
#define HW_VERSION "v1.3.5"

class Display {
 private:
  Logger log{"DISPLAY"};
  LiquidCrystal_I2C* lcd;
  uint8_t foundAddr = 0;

  // Dedicated function for the persistent header (Row 0)
  void updateHeader() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
      if (lcd) {
        lcd->setCursor(0, 0);
        lcd->print("Time Sync Error   ");
      }
      return;
    }

    char timeStr[21];
    // Format: HW_VERSION | HH:MM
    sprintf(timeStr, "%s | %02d:%02d", HW_VERSION, timeinfo.tm_hour, timeinfo.tm_min);

    if (lcd) {
      lcd->setCursor(0, 0);
      lcd->print(timeStr);
    }
  }

  static void taskWrapper(void* pvParameters) {
    Display* instance = (Display*) pvParameters;
    instance->displayLoop();
  }

  void displayLoop() {
    for (;;) {
      // Row 0 is now reserved for the version/time/temp header
      updateHeader();

      // Update once per minute to minimize I2C noise for the QDY30A sensor
      vTaskDelay(pdMS_TO_TICKS(60000));
    }
  }

 public:
  Display() : lcd(nullptr) {}

  void begin() {
    delay(1000);
    log.info("Display init: initializing I2C (SDA=%d, SCL=%d)...", SDA, SCL);
    Wire.begin();
    log.info("Scanning I2C bus...");
    for (byte addr = 0x01; addr < 0x7F; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() == 0) {
        log.info("Found device at 0x%02X", addr);
        foundAddr = addr;  // Save it
      }
    }

    if (foundAddr == 0) {
      log.error("No I2C device found — skipping LCD init");
      return;
    }

    log.info("Initializing LCD at 0x%02X", foundAddr);
    if (lcd)
      delete lcd;
    lcd = new LiquidCrystal_I2C(foundAddr, 20, 4);
    lcd->init();
    lcd->backlight();
    lcd->clear();

    // (Re)create the lcd instance with the detected address on the configured bus
    if (lcd)
      delete lcd;
    lcd = new LiquidCrystal_I2C(foundAddr, 20, 4);
    lcd->init();
    lcd->backlight();
    lcd->clear();

    // Prime the header once immediately so we see initial output in Serial/Display
    updateHeader();

    int rc = xTaskCreatePinnedToCore(Display::taskWrapper, "DisplayTask", 4096, this, 1, NULL, 1);
    if (rc != pdPASS) {
      log.info("Display: failed to create task (%d)\n", rc);
    } else {
      log.info("Display: task created");
    }
  }

  // Use rows 1, 2, and 3 for dynamic data like "Tank Level" or "Pump Status"
  void printLine(String text, int row) {
    log.info("Display: Updating Row %d with: %s\n", row, text.c_str());
    if (row < 1 || row > 3)
      return;  // Protect Row 0 (the Header)

    if (!lcd)
      return;
    lcd->setCursor(0, row);
    while (text.length() < 20) text += " ";
    if (text.length() > 20)
      text = text.substring(0, 20);
    lcd->print(text);
  }

  volatile bool hasPendingUpdate = false;
  char pendingLine[64];
  int pendingRow;

  void enqueueUpdate(const char* msg, int row) {
    strncpy(pendingLine, msg, sizeof(pendingLine) - 1);
    pendingRow = row;
    hasPendingUpdate = true;
  }

  void flushPending() {
    if (hasPendingUpdate) {
      hasPendingUpdate = false;
      printLine(pendingLine, pendingRow);
    }
  }
};

#endif
