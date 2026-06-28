import type { Response } from 'express';
import mqtt from 'mqtt';
import SHARED from '../../shared/plant_config.json';
import {
  appendWaterLevel,
  updateWaterEvent,
  appLog,
  getWaterLevels,
  appendEnvironmentReading,
  getRoomIdForDevice,
  appendDeviceLog,
  upsertDevicePresence,
  getDeviceConfig,
} from '../database/dao';

interface WaterCommandPayload {
  device_id: string;
  event_id: number;
  action: string;
  duration_ms: number;
}

const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://mqtt-broker:1883');
const commandQueue: WaterCommandPayload[] = [];
export const visionListeners = new Set<Response>();

export const serviceStatus = {
  mqttConnected: false,
  lastVisionResult: null as Date | null,
  lastPublisherFrame: null as Date | null,
};

client.on('connect', async () => {
  serviceStatus.mqttConnected = true;
  await appLog({ message: 'Connected to MQTT Broker', source: 'mqttService', level: 'info' });

  const topics: string[] = [
    SHARED.pump_cycle_complete_topic,
    SHARED.water_level_topic,
    SHARED.environment_temp_1f_topic,
    SHARED.environment_humidity_1f_topic,
    SHARED.environment_pressure_1f_topic,
    SHARED.environment_gas_1f_topic,
    SHARED.device_logs_topic,
    SHARED.device_boot_topic,
    'robot/vision/result',
    'robot/vision/tracking',
  ];

  for (const topic of topics) {
    client.subscribe(topic, async (err) => {
      if (err) {
        await appLog({ message: err, details: { topic }, source: 'mqttService', level: 'warn' });
      } else {
        await appLog({ message: `Subscribed to ${topic}`, source: 'mqttService', level: 'info' });
      }
    });
  }

  while (commandQueue.length > 0) {
    const cmd = commandQueue.shift()!;
    publishWaterCommand(cmd);
  }
});

client.on('message', async (topic: string, message: Buffer) => {
  const messageStr = message.toString();

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(messageStr) as Record<string, unknown>;
  } catch {
    data = { raw: messageStr };
  }

  if (topic === SHARED.pump_cycle_complete_topic) {
    const { success, dbError, updatedCount } = await updateWaterEvent({
      event_id: data['event_id'] as number,
      duration: data['duration'] as number,
      status: data['status'] as string,
    });
    if (!success || updatedCount === 0) {
      await appLog({ message: 'Failed to update water event', details: { ...data, updatedCount, debugId: dbError?.debugId }, source: 'mqttService', level: 'error' });
    } else {
      await appLog({ message: `Pump cycle complete: event ${data['event_id']} → ${data['status']}`, details: data, source: 'mqttService', level: 'info' });
    }
  }

  if (topic === SHARED.water_level_topic) {
    const deviceId = data['device_id'] as string;
    const rawValue = data['raw_value'] as number;
    const percentFull = data['percent_full'] as number;
    const config = await getDeviceConfig(deviceId);
    const tankCapacity = config.tank_capacity_gallons ?? 30;

    let gallons: number;
    let calibratedPct: number;
    if (config.calibration_raw && config.calibration_gallons && config.calibration_raw > 0) {
      gallons = Math.max(0, Math.min(tankCapacity, rawValue * config.calibration_gallons / config.calibration_raw));
      calibratedPct = (gallons / tankCapacity) * 100;
    } else {
      gallons = (percentFull / 100) * tankCapacity;
      calibratedPct = percentFull;
    }

    const appendRes = await appendWaterLevel({
      device_id: deviceId,
      gallons,
      raw_value: rawValue,
      percent_full: calibratedPct,
    });

    if (!appendRes.success) {
      await appLog({ message: 'Failed to persist tank reading', details: { device_id: deviceId, debugId: appendRes.dbError?.debugId }, source: 'mqttService', level: 'error' });
    }
  }

  if (topic === 'robot/vision/result') {
    serviceStatus.lastVisionResult = new Date();
    for (const res of visionListeners) {
      try {
        res.write(`data: ${messageStr}\n\n`);
      } catch {
        visionListeners.delete(res);
      }
    }
  }

  if (topic === 'robot/vision/tracking') {
    serviceStatus.lastPublisherFrame = new Date();
  }

  if (topic === SHARED.device_logs_topic) {
    await appendDeviceLog({
      device_id: (data['device_id'] ?? data['device_name'] ?? 'unknown') as string,
      log_level: (data['log_level'] ?? 'info') as string,
      message: data['message'] as string,
    });
  }

  if (topic === SHARED.device_boot_topic) {
    const device_id = (data['device_id'] ?? data['device_name'] ?? '') as string;
    const ip_address = (data['ip'] ?? '') as string;
    if (device_id) {
      await upsertDevicePresence({ device_id, ip_address });
    }
  }

  const envTopicMap: Record<string, string> = {
    [SHARED.environment_temp_1f_topic]: 'temperature_f',
    [SHARED.environment_humidity_1f_topic]: 'humidity_pct',
    [SHARED.environment_pressure_1f_topic]: 'pressure_hpa',
    [SHARED.environment_gas_1f_topic]: 'iaq',
  };

  if (Object.prototype.hasOwnProperty.call(envTopicMap, topic)) {
    let value: number | null;
    if (typeof data === 'object' && !('raw' in data)) {
      value = (data['value'] ?? data['v'] ?? data['reading'] ?? null) as number | null;
    } else {
      value = parseFloat(messageStr);
    }

    const metric = envTopicMap[topic];
    const deviceId = (data['device_id'] ?? data['device_name'] ?? 'env-unknown') as string;
    const roomId = await getRoomIdForDevice(deviceId);
    const readings = { metric, value };

    const { success, dbError } = await appendEnvironmentReading({ device_id: deviceId, room_id: roomId, readings });
    if (!success) {
      await appLog({ message: 'Failed to persist environment reading', details: { topic, deviceId, readings, debugId: dbError?.debugId }, source: 'mqttService', level: 'error' });
    }
  }
});

client.on('reconnect', async () => {
  await appLog({ message: 'MQTT client attempting to reconnect', source: 'mqttService', level: 'warn' });
});

client.on('offline', async () => {
  serviceStatus.mqttConnected = false;
  await appLog({ message: 'MQTT client went offline', source: 'mqttService', level: 'warn' });
});

client.on('error', async (err: Error) => {
  await appLog({ message: err, source: 'mqttService', level: 'error' });
});

function getTopicName(device_id: string): string {
  return SHARED.pump_topic_template.replace('{device_id}', device_id);
}

function getMessageString(payload: { event_id: number; action: string; duration_ms: number }): string {
  return JSON.stringify(payload);
}

async function canWaterPlants(device_id: string): Promise<boolean> {
  const { success, rows: lastWaterLevelData, dbError } = await getWaterLevels(1, device_id);
  if (!success || lastWaterLevelData.length === 0) {
    await appLog({ message: 'Failed to fetch water level data', details: { debugId: dbError?.debugId }, source: 'mqttService', level: 'error' });
    return false;
  }
  const latestLevel = lastWaterLevelData[0].pct_full;
  return latestLevel > 4; // percentage-based; tank-size-agnostic
}

export function publishLearnFrame(name: string, imageBase64: string): boolean {
  if (!client.connected) return false;
  const payload = JSON.stringify({ name, frame: imageBase64 });
  client.publish('robot/vision/learn', payload, { qos: 1 });
  return true;
}

export async function publishWaterCommand(payload: WaterCommandPayload): Promise<boolean> {
  const { device_id, event_id, action, duration_ms } = payload;

  const safe = await canWaterPlants(device_id);
  if (!safe) {
    await appLog({ message: `Safety Block: Tank level too low for ${device_id}`, details: { event_id, device_id }, source: 'mqttService', level: 'warn' });
    await updateWaterEvent({ event_id, duration: 0, status: 'BLOCKED_LOW_WATER' });
    return false;
  }

  if (client.connected) {
    const topicName = getTopicName(device_id);
    const messageString = getMessageString({ event_id, action, duration_ms });
    client.publish(topicName, messageString, { qos: 1 });
    await appLog({ message: `Command Published: ${topicName}`, details: { event_id, action, duration_ms }, source: 'mqttService', level: 'info' });
    return true;
  } else {
    await appLog({ message: 'Broker offline. Queueing command.', details: { device_id, event_id, action, duration_ms }, source: 'mqttService', level: 'warn' });
    commandQueue.push(payload);
    return false;
  }
}
