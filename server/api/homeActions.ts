import { getDevices, appendWaterHistory, getWaterHistory } from '../database/dao';
import { publishWaterCommand } from '../pubsub/mqttService';
import SHARED from '../../shared/plant_config.json';

const DEFAULT_DURATION_SECONDS = 60;

export interface ActionResult {
  success: boolean;
  summary: string;
}

export async function waterPlants(): Promise<ActionResult> {
  const { rows: allDevices } = await getDevices();
  const pumps = allDevices.filter((d) => d.device_type === 'pump');

  if (!pumps.length) {
    return { success: false, summary: 'No watering devices are configured.' };
  }

  const lines: string[] = [];
  let anyStarted = false;

  for (const device of pumps) {
    const name = device.friendly_name || device.device_id;

    // Check cooldown
    const { rows: history } = await getWaterHistory({
      device: device.device_id,
      page: 0,
      rows: 1,
      order: 'DESC',
    });
    const last = history[0];
    if (last?.status === SHARED.water_status_complete) {
      const hoursSince = (Date.now() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60);
      if (hoursSince < SHARED.pump_cycle_cooldown_hours) {
        const minutesAgo = Math.round(hoursSince * 60);
        const hoursLeft = (SHARED.pump_cycle_cooldown_hours - hoursSince).toFixed(1);
        lines.push(
          `${name}: skipped — watered ${minutesAgo} min ago (${hoursLeft} hrs until next cycle allowed)`
        );
        continue;
      }
    }

    // Schedule the event
    const { success, eventId } = await appendWaterHistory({
      deviceId: device.device_id,
      durationMs: DEFAULT_DURATION_SECONDS * 1000,
      action: SHARED.water_action_on,
      userEmail: 'papu',
    });

    if (!success || eventId === null) {
      lines.push(`${name}: failed to schedule`);
      continue;
    }

    // Publish — publishWaterCommand has its own low-water safety block
    const sent = await publishWaterCommand({
      event_id: eventId,
      device_id: device.device_id,
      action: SHARED.water_action_on,
      duration_ms: DEFAULT_DURATION_SECONDS * 1000,
    });

    anyStarted = true;
    lines.push(
      sent
        ? `${name}: watering started (${DEFAULT_DURATION_SECONDS}s)`
        : `${name}: command queued (MQTT broker temporarily offline)`
    );
  }

  return { success: anyStarted, summary: lines.join('\n') };
}
