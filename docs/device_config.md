# Device Configuration Roadmap

Making devices easier to configure without touching code or firmware.

---

## Step 1 — Devices Page ✅ Done

Added `html/devices.html`: lists all registered devices, shows last pump event and tank level, lets users add new devices (device_id, friendly name, type, room, OTA flag).

---

## Step 2 — Configurable Tank Capacity (gallons) ✅ Done

**Problem:** `maxGallons = 30.0` is hard-coded in `hardware/plant-node/src/sensor.h:30`. Every tank is assumed to be 30 gallons. The low-water guard in `server/api/index.ts:268` also has `30` hard-coded. Users with different tank sizes get wrong readings without recompiling.

**What already works in our favor:**
- `tank_readings` DB table already stores `raw_value` AND `pct_full` alongside `gallons`. That means the server can recalculate gallons from config without a firmware change — just `(pct_full / 100) * tank_capacity_gallons`.
- The devices table has a `device_id` primary key, so per-device config is straightforward to add.

**Plan:**

1. **DB migration** — add a `device_settings` table (or a `config JSONB` column on `devices`):
   ```sql
   ALTER TABLE devices ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
   ```
   Store `{ "tank_capacity_gallons": 30 }` for pump/tank devices.

2. **API** — add `GET /api/devices/:id/config` and `PATCH /api/devices/:id/config` endpoints so the UI can read and write per-device config.

3. **Server recalculates gallons** — in `server/api/index.ts`, after fetching tank readings, multiply `pct_full` by the device's configured capacity instead of using the raw `gallons` value the firmware sent.
   - Also fix the `gallons < 3` low-water guard at `index.ts:268` to use configured capacity.

4. **Devices UI** — add an editable "Tank capacity (gal)" field in the device detail/edit panel on `html/devices.html`.

5. **Firmware (optional / later)** — push capacity to the device via MQTT so the onboard log output is also correct. Low priority since the server is the source of truth for displayed values.

---

## Step 3 — Water Level Sensor Calibration 🔲 Future

**Problem:** The AC-based water level sensors have a physical "zero" trim knob that must be adjusted until the idle signal is near zero. This is fiddly and can drift. The firmware uses `rawEmptyValue` and `rawFullValue` to calibrate, but these are also hard-coded.

**Goal:** Let users set calibration values (empty ADC count, full ADC count) per device through the web UI, without opening the hardware or recompiling firmware.

**Options to evaluate:**

- **Server-side recalc** — store `raw_empty` / `raw_full` per device in `device.config`. The server already has `raw_value` in `tank_readings`; it can recompute `pct_full = (raw - raw_empty) / (raw_full - raw_empty) * 100` and then gallons. No firmware change needed, but onboard logs will still show the uncalibrated percentage.

- **Firmware config via MQTT** — on boot the device subscribes to a config topic (e.g., `home/devices/{device_id}/config`); the server publishes `{ raw_empty, raw_full, max_gallons }`. Device stores in NVS and uses for all subsequent readings. More accurate onboard, but requires firmware changes and NVS handling.

**Recommended approach:** start with server-side recalc (no firmware OTA required), add firmware push later.

**Dependencies:** Completing Step 2 first (the `config` column and edit UI) makes Step 3 mostly a matter of adding two more config fields to the same pattern.

---

## Step 4 — Environment Sensor Configuration 🔲 Future

**Problem:** Environment sensors (BME680) have no per-device calibration or labeling beyond room assignment, which is already handled.

**Potential improvements:**
- Altitude-based pressure correction (affects IAQ accuracy)
- Custom alert thresholds per room (e.g., humidity > 70% in basement triggers alert)
- Sensor offset corrections if a unit reads consistently high/low

Low urgency — environment sensors are generally accurate out of the box.

---

## Notes

- The `rawEmptyValue`/`rawFullValue` constructor params in `SensorNode` (`sensor.h:42`) are the right hooks for calibration once we decide to push config via MQTT.
- All config changes should be applied to historical readings retroactively where possible (server recalculates from stored `raw_value` / `pct_full`), so the charts don't show a discontinuity when a user corrects a setting.
