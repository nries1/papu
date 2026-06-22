#ifndef SHARED_CONSTANTS_H
#define SHARED_CONSTANTS_H

static const char* SHARED_STATUS_COMPLETE = "complete";
static const char* SHARED_ACTION_WATER_ON = "WATER_ON";
static const char* SHARED_TOPIC_WATER_LEVEL = "home/plants/water_level";
static const char* SHARED_TOPIC_PUMP = "plants/{device_id}/pump";
static const char* SHARED_TOPIC_PUMP_CYCLE_COMPLETE = "home/plants/feedback";
static const char* SHARED_TOPIC_TEMP_1F = "home/sensors/temperature";
static const char* SHARED_TOPIC_HUMIDITY_1F = "home/sensors/humidity";
static const char* SHARED_TOPIC_PRESSURE_1F = "home/sensors/pressure";
static const char* SHARED_TOPIC_GAS_1F = "home/sensors/iaq";
static const char* SHARED_TOPIC_DEVICE_LOGS = "home/devices/logs";
static const char* SHARED_TOPIC_DEVICE_BOOT = "home/devices/boot";

#endif
