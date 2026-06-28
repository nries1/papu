import axios from 'axios';
import { getDevices, appendWaterHistory, getWaterHistory } from '../database/dao';
import { publishWaterCommand } from '../pubsub/mqttService';
import SHARED from '../../shared/plant_config.json';

const HA_URL = process.env.HOMEASSISTANT_URL || 'http://homeassistant:8123';
const HA_TOKEN = process.env.HOMEASSISTANT_TOKEN || '';

export interface LightEntityInfo {
  entity_id: string;
  friendly_name: string;
  state: string;
  brightness_pct?: number;
}

export async function getLightEntities(): Promise<LightEntityInfo[]> {
  if (!HA_TOKEN) return [];
  try {
    const res = await axios.get<
      Array<{
        entity_id: string;
        state: string;
        attributes: { friendly_name?: string; brightness?: number };
      }>
    >(`${HA_URL}/api/states`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
      timeout: 5000,
    });
    return res.data
      .filter((e) => e.entity_id.startsWith('light.'))
      .map((e) => ({
        entity_id: e.entity_id,
        friendly_name: e.attributes.friendly_name || e.entity_id.replace('light.', '').replace(/_/g, ' '),
        state: e.state,
        brightness_pct: e.attributes.brightness !== undefined
          ? Math.round((e.attributes.brightness / 255) * 100)
          : undefined,
      }));
  } catch {
    return [];
  }
}

export interface LightCommand {
  entity_ids: string[];
  action: 'turn_on' | 'turn_off';
  brightness_pct?: number;
  rgb_color?: [number, number, number];
  kelvin?: number;
}

export async function controlLight(command: LightCommand): Promise<ActionResult> {
  if (!HA_TOKEN) {
    return { success: false, summary: 'Home Assistant is not configured (missing HOMEASSISTANT_TOKEN).' };
  }
  if (!command.entity_ids.length) {
    return { success: false, summary: 'No lights matched that request.' };
  }

  const payload: Record<string, unknown> = { entity_id: command.entity_ids };
  if (command.action === 'turn_on') {
    if (command.brightness_pct !== undefined) {
      payload.brightness_pct = Math.max(1, Math.min(100, command.brightness_pct));
    }
    if (command.rgb_color) payload.rgb_color = command.rgb_color;
    if (command.kelvin) payload.color_temp_kelvin = command.kelvin;
  }

  try {
    await axios.post(`${HA_URL}/api/services/light/${command.action}`, payload, {
      headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, summary: `Light control failed: ${msg}` };
  }

  const names = command.entity_ids
    .map((id) => id.replace(/^light\./, '').replace(/_/g, ' '))
    .join(', ');

  let verb = command.action === 'turn_off' ? 'turned off' : 'turned on';
  if (command.action === 'turn_on') {
    if (command.brightness_pct !== undefined) verb += ` at ${command.brightness_pct}%`;
    if (command.rgb_color) verb += ` with custom color`;
    if (command.kelvin) verb += ` at ${command.kelvin}K`;
  }

  return { success: true, summary: `${names}: ${verb}` };
}

const DEFAULT_DURATION_SECONDS = 30;

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
