#ifndef DEVICE_H
#define DEVICE_H

#include <Arduino.h>
#include "esp_mac.h"
#include "nvs.h"
#include "nvs_flash.h"

#define NVS_NAMESPACE "device"
#define NVS_NAME_KEY "device_name"
#define NVS_ROOM_KEY "room_name"

class Device {
 public:
  static String getDeviceID() {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char id[9];
    snprintf(id, sizeof(id), "%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(id);  // e.g. "A1B2C3"
  }
  void setDeviceName(const char* name) {
    nvs_handle_t handle;
    nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    nvs_set_str(handle, NVS_NAME_KEY, name);
    nvs_commit(handle);
    nvs_close(handle);
  }
  static String getDeviceName() {
    nvs_handle_t handle;
    char name[64] = "unnamed";

    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_OK) {
      size_t len = sizeof(name);
      nvs_get_str(handle, NVS_NAME_KEY, name, &len);
      nvs_close(handle);
    }
    return String(name);
  }
  void setFriendlyRoomName(const char* room) {
    nvs_handle_t handle;
    nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    nvs_set_str(handle, NVS_ROOM_KEY, room);
    nvs_commit(handle);
    nvs_close(handle);
  }
  static String getFriendlyRoomName() {
    nvs_handle_t handle;
    char room[64] = "unknown";
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_OK) {
      size_t len = sizeof(room);
      nvs_get_str(handle, NVS_ROOM_KEY, room, &len);
      nvs_close(handle);
    }
    return String(room);
  }
  void begin(const char* name, const char* room) {
    // NVS must be initialized once at boot
    nvs_flash_init();

    // --- Set name once (comment out after first flash) ---
    setDeviceName(name);
    setFriendlyRoomName(room);

    Serial.println("Device ID:   " + getDeviceID());          // e.g. "A1B2C3"
    Serial.println("Device Name: " + getDeviceName());        // e.g. "living_room"
    Serial.println("Room:        " + getFriendlyRoomName());  // e.g. "living_room"
  }
};

#endif  // DEVICE_H
