#include <Arduino.h>
#include <ArduinoJson.h>
#undef BOARD_HAS_PSRAM  // force HUB75 DMA buffers into internal SRAM
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <time.h>

#include "config.h"
#include "logger.h"
#include "ota.h"

// --- Device identity -------------------------------------------------------
// Overridden at flash time via flash.js --name build flag; --name also sets the
// OTA host (<name>.local). Default preserves the original hostname.
#define STRINGIFY(x) #x
#define TO_STRING(x) STRINGIFY(x)

#ifndef DEVICE_NAME
#define DEVICE_NAME rgb-display
#endif

// Seengreat Adapter Board E — V2.x pin mapping (ESP32-S3 DevKitC-1 form factor)
#define R1_PIN 18
#define G1_PIN  8
#define B1_PIN 17
#define R2_PIN 16
#define G2_PIN  1
#define B2_PIN 15
#define A_PIN   7
#define B_PIN  48
#define C_PIN   6
#define D_PIN  47
#define E_PIN   2
#define CLK_PIN 5
#define LAT_PIN 21
#define OE_PIN   4

#define PANEL_W    64
#define PANEL_H    32
#define PAGE_COUNT  5
#define PAGE_MS  5000UL
#define FETCH_MS 300000UL  // 5 min

// US Eastern time: UTC-5 standard, +1h DST
#define TZ_OFFSET_SEC (-5 * 3600)
#define TZ_DST_SEC     3600

// rgb565 color helpers (computed at compile time)
#define RGB565(r, g, b) \
  (((uint16_t)((r) >> 3) << 11) | ((uint16_t)((g) >> 2) << 5) | ((uint16_t)((b) >> 3)))
#define COL_BLACK  0
#define COL_WHITE  RGB565(255, 255, 255)
#define COL_CYAN   RGB565(0, 200, 220)
#define COL_YELLOW RGB565(255, 210, 0)
#define COL_GREEN  RGB565(0, 200, 60)
#define COL_RED    RGB565(220, 40, 40)
#define COL_ORANGE RGB565(255, 130, 0)
#define COL_DIM    RGB565(110, 110, 110)

// ---- Data model ----

struct TankData {
  char  label[4];
  float gallons;
  int   pct_full;
};

struct WaterEventData {
  char label[4];
  long seconds_ago;
};

struct HomeStats {
  float outdoor_temp_f;
  char  outdoor_desc[20];
  float living_room_temp_f;
  float office_temp_f;
  float avg_humidity_pct;
  float avg_iaq;
  TankData       tanks[2];
  int            tank_count;
  WaterEventData water_events[2];
  int            water_event_count;
  bool           valid;
};

Logger logger{"DISPLAY"};
MatrixPanel_I2S_DMA* display = nullptr;
HomeStats stats = {};
int           currentPage   = 0;
unsigned long lastPageFlip  = 0;
unsigned long lastFetch     = 0;
unsigned long lastClockDraw = 0;

// ---- Text helpers ----

void txt(int x, int y, const char* s, uint16_t color, uint8_t size = 1) {
  display->setTextSize(size);
  display->setTextColor(color);
  display->setCursor(x, y);
  display->print(s);
}

void txtR(int y, const char* s, uint16_t color, uint8_t size = 1) {
  int w = strlen(s) * 6 * size;
  int x = PANEL_W - w;
  if (x < 0) x = 0;
  txt(x, y, s, color, size);
}

void txtC(int y, const char* s, uint16_t color, uint8_t size = 1) {
  int w = strlen(s) * 6 * size;
  int x = (PANEL_W - w) / 2;
  if (x < 0) x = 0;
  txt(x, y, s, color, size);
}

uint16_t tankColor(int pct) {
  if (pct > 50) return COL_GREEN;
  if (pct > 25) return COL_ORANGE;
  return COL_RED;
}

void formatTimeAgo(char* out, int outLen, long sec) {
  if (sec < 3600)       snprintf(out, outLen, "%ldm ago", sec / 60 + 1);
  else if (sec < 86400) snprintf(out, outLen, "%ldh ago", sec / 3600);
  else                  snprintf(out, outLen, "%ldd ago", sec / 86400);
}

// ---- Page drawing ----

void drawClock() {
  display->clearScreen();
  time_t now = time(nullptr);
  if (now < 1000000) {
    txtC(12, "SYNCING", COL_DIM);
    return;
  }
  struct tm* ti = localtime(&now);

  char timeBuf[6];
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d", ti->tm_hour, ti->tm_min);
  txtC(0, timeBuf, COL_CYAN, 2);

  const char* days[]   = {"SUN","MON","TUE","WED","THU","FRI","SAT"};
  const char* months[] = {"JAN","FEB","MAR","APR","MAY","JUN",
                           "JUL","AUG","SEP","OCT","NOV","DEC"};
  char dateBuf[12];
  snprintf(dateBuf, sizeof(dateBuf), "%s %02d %s",
           days[ti->tm_wday], ti->tm_mday, months[ti->tm_mon]);
  txtC(22, dateBuf, COL_WHITE);
}

void drawWeather() {
  display->clearScreen();
  txtC(0, "BROOKLYN", COL_CYAN);
  if (!stats.valid) { txtC(10, "---", COL_DIM, 2); return; }
  char buf[8];
  snprintf(buf, sizeof(buf), "%.0fF", stats.outdoor_temp_f);
  txtC(8, buf, COL_YELLOW, 2);
  char desc[11];
  strncpy(desc, stats.outdoor_desc, 10);
  desc[10] = '\0';
  txtC(24, desc, COL_WHITE);
}

void drawTemps() {
  display->clearScreen();
  txt(0, 0, "INDOORS", COL_CYAN);
  if (!stats.valid) { txtC(12, "---", COL_DIM); return; }
  char buf[10];
  txt(0, 10, "LR:", COL_DIM);
  snprintf(buf, sizeof(buf), "%.1fF", stats.living_room_temp_f);
  txtR(10, buf, COL_YELLOW);
  txt(0, 20, "OFFICE:", COL_DIM);
  snprintf(buf, sizeof(buf), "%.1fF", stats.office_temp_f);
  txtR(20, buf, COL_YELLOW);
}

void drawEnvironment() {
  display->clearScreen();
  txt(0, 0, "ENVIRON", COL_CYAN);
  if (!stats.valid) { txtC(12, "---", COL_DIM); return; }
  char buf[10];
  txt(0, 10, "HUMIDITY:", COL_DIM);
  snprintf(buf, sizeof(buf), "%.0f%%", stats.avg_humidity_pct);
  txtR(10, buf, COL_YELLOW);
  txt(0, 20, "AIR QUAL:", COL_DIM);
  snprintf(buf, sizeof(buf), "%.0f", stats.avg_iaq);
  txtR(20, buf, COL_YELLOW);
}

void drawPlants() {
  display->clearScreen();
  if (!stats.valid) {
    txtC(0, "PLANTS", COL_CYAN);
    txtC(12, "---", COL_DIM);
    return;
  }
  for (int i = 0; i < 2; i++) {
    int y = i * 8;
    if (i < stats.tank_count) {
      char left[5], right[10];
      snprintf(left,  sizeof(left),  "%s:", stats.tanks[i].label);
      snprintf(right, sizeof(right), "%.1fg", stats.tanks[i].gallons);
      txt(0, y, left,  COL_DIM);
      txtR(y,   right, tankColor(stats.tanks[i].pct_full));
    }
  }
  for (int i = 0; i < 2; i++) {
    int y = 16 + i * 8;
    if (i < stats.water_event_count) {
      char ago[10], line[14];
      formatTimeAgo(ago, sizeof(ago), stats.water_events[i].seconds_ago);
      snprintf(line, sizeof(line), "%s %s", stats.water_events[i].label, ago);
      txt(0, y, line, COL_DIM);
    }
  }
}

void drawPage(int page) {
  switch (page) {
    case 0: drawClock();       break;
    case 1: drawWeather();     break;
    case 2: drawTemps();       break;
    case 3: drawEnvironment(); break;
    case 4: drawPlants();      break;
  }
}

// ---- Data fetch ----

void fetchStats() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(API_HOST) + "/api/display-stats?token=" + DISPLAY_TOKEN;
  http.begin(url);
  http.setTimeout(4000);
  int code = http.GET();

  if (code != 200) {
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return;

  stats.outdoor_temp_f = doc["outdoor"]["temp_f"] | 0.0f;
  strlcpy(stats.outdoor_desc, doc["outdoor"]["description"] | "---", sizeof(stats.outdoor_desc));
  stats.living_room_temp_f = doc["living_room"]["temp_f"] | 0.0f;
  stats.office_temp_f      = doc["office"]["temp_f"] | 0.0f;
  stats.avg_humidity_pct   = doc["avg_humidity_pct"] | 0.0f;
  stats.avg_iaq            = doc["avg_iaq"] | 0.0f;

  stats.tank_count = 0;
  for (JsonObject t : doc["tanks"].as<JsonArray>()) {
    if (stats.tank_count >= 2) break;
    TankData& td = stats.tanks[stats.tank_count++];
    strlcpy(td.label, t["label"] | "T?", sizeof(td.label));
    td.gallons  = t["gallons"]  | 0.0f;
    td.pct_full = t["pct_full"] | 0;
  }

  stats.water_event_count = 0;
  for (JsonObject e : doc["last_water"].as<JsonArray>()) {
    if (stats.water_event_count >= 2) break;
    WaterEventData& wd = stats.water_events[stats.water_event_count++];
    strlcpy(wd.label, e["label"] | "T?", sizeof(wd.label));
    wd.seconds_ago = e["seconds_ago"] | 0L;
  }

  stats.valid = true;
}

// ---- WiFi ----

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(250);
  }
}

// ---- Setup & Loop ----

void setup() {
  Serial.begin(115200);

  HUB75_I2S_CFG::i2s_pins pins = {R1_PIN, G1_PIN, B1_PIN, R2_PIN, G2_PIN, B2_PIN,
                                   A_PIN,  B_PIN,  C_PIN,  D_PIN,  E_PIN,
                                   LAT_PIN, OE_PIN, CLK_PIN};
  HUB75_I2S_CFG mxconfig(PANEL_W, PANEL_H, 1, pins);
  display = new MatrixPanel_I2S_DMA(mxconfig);
  if (!display->begin()) {
    logger.error("Matrix init failed");
    while (true) delay(1000);
  }
  display->setTextWrap(false);
  display->clearScreen();
  display->setBrightness8(30);
  txtC(12, "CONNECTING", COL_DIM);
  display->setBrightness8(0);

  connectWiFi();
  OTAService::begin(TO_STRING(DEVICE_NAME));  // set via flash.js --name (default: rgb-display)

  display->setBrightness8(30);
  configTime(TZ_OFFSET_SEC, TZ_DST_SEC, "pool.ntp.org");
  display->clearScreen();
  txtC(12, "FETCHING", COL_DIM);
  fetchStats();

  lastFetch      = millis();
  lastPageFlip   = millis();
  lastClockDraw  = millis();
  drawPage(0);
}

void loop() {
  OTAService::handle();
  unsigned long now = millis();

  if (currentPage == 0 && now - lastClockDraw >= 1000) {
    lastClockDraw = now;
    drawClock();
  }

  if (now - lastPageFlip >= PAGE_MS) {
    lastPageFlip = now;
    currentPage  = (currentPage + 1) % PAGE_COUNT;
    drawPage(currentPage);
    if (currentPage == 0) lastClockDraw = now;
  }

  if (now - lastFetch >= FETCH_MS) {
    lastFetch = now;
    if (WiFi.status() != WL_CONNECTED) connectWiFi();
    fetchStats();
    drawPage(currentPage);
  }
}
