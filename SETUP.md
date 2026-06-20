# Setup Guide

## Prerequisites

- [Docker + Docker Compose](https://docs.docker.com/get-docker/)
- [Node.js 18+](https://nodejs.org/) — for npm scripts
- [PlatformIO CLI](https://docs.platformio.org/en/latest/core/installation/) — for flashing firmware (`pip install platformio`)
- [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/) — for port detection during flashing

## 1. Clone & configure

```bash
git clone https://github.com/YOUR_USERNAME/home.git
cd home
```

Copy the environment templates and fill in your values:

```bash
cp .env.example .env
cp hardware/lib/shared/config.h.example hardware/lib/shared/config.h
```

Edit `.env` — at minimum set `POSTGRES_PASSWORD`, `DISPLAY_TOKEN`, and `ZIP_CODE`.

Edit `config.h` — set your WiFi credentials, server IP, and the same `DISPLAY_TOKEN` you put in `.env`.

> **Note:** `DISPLAY_TOKEN` must match in both files. Generate one with `openssl rand -hex 24`.

## 2. Start the server stack

```bash
npm run up
```

This starts: nginx (port 80), the Node API (port 5000), PostgreSQL, and the MQTT broker.

The dashboard will be available at `http://YOUR_SERVER_IP`.

**With a GPU (for robot vision and LLM):**

```bash
docker compose --profile gpu up -d
```

This additionally starts the Ollama LLM server and the face recognition worker. Requires an NVIDIA GPU with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

## 3. Run the database migration

```bash
npm run db:migrate
```

## 4. Flash the hardware

Connect an ESP32 board via USB, then:

```bash
# Plant node (Adafruit Metro ESP32-S3)
npm run hw:flash

# Environment sensor (ESP32-C3 Super Mini)
npm run env:flash

# RGB display (ESP32-S3)
npm run display:flash
```

Each flash command auto-detects the board's USB port via `arduino-cli board list`.

To see what boards are connected:

```bash
npm run hw:list
```

## 5. Enroll faces (robot vision, optional)

From the machine with the webcam, use `vision:enroll` to register a person — this both trains the face model and adds a display name to the database:

```bash
npm run vision:enroll -- <userId> <name> /path/to/photos/
```

- **userId** — the recognition ID stored in the model (e.g. `nries1`). Keep it lowercase with no spaces.
- **name** — the friendly display name shown in the UI (e.g. `nico`).
- **photos dir** — a directory of jpg/png photos of that person (10–30 photos recommended).

Example:

```bash
npm run vision:enroll -- nries1 nico ~/photos/nico/
```

To enroll from the live webcam instead of photos:

```bash
npm run vision:learn -- "nries1"
```

Start publishing webcam frames to the vision pipeline:

```bash
npm run vision:publish
```

## Troubleshooting

**Board not detected during flash:** Run `npm run hw:list` and verify `arduino-cli` recognizes the board. The board FQBN must match what's in `package.json`. Some community boards (like the ESP32-C3 Super Mini) require installing third-party board definitions first: `arduino-cli core install esp32:esp32`.

**Database connection errors:** Make sure `POSTGRES_PASSWORD` in `.env` matches what Postgres was initialized with. If you changed it after first run, you may need to `docker compose down -v` to wipe the volume and start fresh.

**GPU services not starting:** Ensure the NVIDIA Container Toolkit is installed and `docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi` works before starting with `--profile gpu`.
