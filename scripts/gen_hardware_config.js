const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../shared/plant_config.json');
const headerPath = path.join(
  __dirname,
  '../hardware/shared/shared_constants.h'
);

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const header = `#ifndef SHARED_CONSTANTS_H
#define SHARED_CONSTANTS_H

static const char* SHARED_STATUS_COMPLETE = "${config.water_status_complete}";
static const char* SHARED_ACTION_WATER_ON = "${config.water_action_on}";
static const char* SHARED_TOPIC_WATER_LEVEL = "${config.water_level_topic}";
static const char* SHARED_TOPIC_PUMP = "${config.pump_topic}";
static const char* SHARED_TOPIC_PUMP_CYCLE_COMPLETE = "${config.pump_cycle_complete_topic}";
static const char* SHARED_TOPIC_TEMP_1F = "${config.environment_temp_1f_topic}";
static const char* SHARED_TOPIC_HUMIDITY_1F = "${config.environment_humidity_1f_topic}";
static const char* SHARED_TOPIC_PRESSURE_1F = "${config.environment_pressure_1f_topic}";
static const char* SHARED_TOPIC_GAS_1F = "${config.environment_gas_1f_topic}";
static const char* SHARED_TOPIC_DEVICE_LOGS = "${config.device_logs_topic}";

#endif
`;

fs.writeFileSync(headerPath, header, 'utf8');
console.log(`Wrote ${headerPath}`);
