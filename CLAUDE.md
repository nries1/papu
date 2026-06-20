# Home IoT & Robot Project

## Overview

A home IoT and robotics system running on a home server. The project has two main areas:

1. **Plant/home monitoring** — ESP32 nodes reporting soil moisture, water tanks, temperature, humidity, IAQ; automated watering via MQTT commands; web dashboard with Cloudflare Access auth.
2. **Robot head** *(active development)* — webcam face recognition, servo-driven pan/tilt head tracking, voice listening, and LLM-powered responses using a local GPU.

---

## Architecture (Docker Compose on home server)

| Service | Description |
|---|---|
| `nginx` | Static web dashboard (`html/`) on port 80 |
| `api` | Node.js/Express REST API on port 5000 |
| `db` | PostgreSQL 15, database `plants` |
| `mqtt-broker` | Eclipse Mosquitto on ports 1883 / 9001 |
| `ollama` | Local LLM server on port 11434, GPU-accelerated, model `llama3.2` |
| `robot-vision-worker` | Python — CNN dlib face recognition (CUDA), publishes recognition results |

**Publisher** (runs on MacBook, not in compose):
- `robot-vision-publisher/publisher.py` — captures webcam at ~10 fps, runs fast local Haar cascade detection at 320×240, publishes raw frames and pan/tilt tracking data to MQTT.

---

## Robot Vision Pipeline

```
MacBook webcam
  │
  ├─ Fast Haar detection (320×240) → robot/vision/tracking  (low-latency pan/tilt)
  │
  └─ Full JPEG → robot/vision/frame
                      │
              robot-vision-worker (GPU)
              CNN dlib recognition
                      │
              robot/vision/result  (name, confidence, bbox, pan/tilt)
```

### MQTT Topics

| Topic | Direction | Content |
|---|---|---|
| `robot/vision/frame` | publisher → worker | Raw JPEG bytes |
| `robot/vision/tracking` | publisher → all | Fast face pan/tilt deltas `{faces: [{pan_delta, tilt_delta}]}` |
| `robot/vision/result` | worker → all | Recognition JSON `{faces: [{name, confidence, bbox, pan_delta, tilt_delta}]}` |
| `robot/vision/learn` | enroll tool → worker | `{name, frame: base64-JPEG}` |

Pan/tilt deltas are in [-0.5, 0.5]; positive pan = right, positive tilt = down.

### Face Enrollment

```bash
# From webcam (MacBook)
python robot-vision-publisher/learn_face.py "Name" --broker <server-ip>

# From photos directory
python robot-vision-publisher/learn_face.py "Name" --broker <server-ip> --images /path/to/photos/
```

Encodings persisted at: `robot-vision-worker/known_faces/encodings.pkl`

---

## What's Next: Robot Head

The robot head is the current active initiative. Work to be done:

1. **Servo control service** — subscribes to `robot/vision/tracking`, drives pan/tilt servos to keep face centered. Likely a small Python service on a Raspberry Pi or Arduino.
2. **Speech input** — microphone → speech-to-text (local, e.g. Whisper) → text prompt.
3. **LLM response** — send prompt to Ollama (`http://localhost:11434`) with the existing `llama3.2` model (or a better open-source model if the GPU can handle it). The `/api/chat` endpoint in the Node API already has a working Ollama proxy.
4. **TTS output** — convert LLM text response to speech and play through speaker.
5. **Person identification integration** — use `robot/vision/result` name field to personalize responses.

---

## Development Commands

```bash
# Start all server services
docker-compose up -d

# View logs
docker-compose logs -f robot-vision-worker

# Start vision publisher (MacBook)
python robot-vision-publisher/publisher.py --broker <server-ip> --show-results

# API
http://localhost:5000

# Web dashboard
http://localhost:80
```

---

## Key Files

| Path | Purpose |
|---|---|
| `robot-vision-publisher/publisher.py` | Webcam → MQTT frames + fast tracking |
| `robot-vision-publisher/learn_face.py` | Face enrollment CLI |
| `robot-vision-worker/worker.py` | GPU CNN recognition worker |
| `api/index.js` | REST API (includes `/api/chat` → Ollama) |
| `api/mqttService.js` | MQTT client for API server |
| `docker-compose.yml` | All service definitions |
| `hardware/plant-node/` | ESP32 firmware (Arduino) |
| `shared/plant_config.json` | Shared config (watering constants, etc.) |

---

## Auth & Access

- **Cloudflare Access** protects the web dashboard and most API routes.
- Admin email: `nries1@gmail.com`
- Display board uses token auth via `DISPLAY_TOKEN` env var (bypasses CF headers).
- DB creds in `.env` (not committed).

---

## Hardware (Arduino/ESP32)

Sketches in `hardware/`:
- `plant-node/` — ESP32 watering node (soil sensor, pump, tank ultrasonic)
- `environment-sensor/` — temperature, humidity, IAQ (BME680)
- `rgb-display/` — RGB LED matrix display
- `shared/` — shared constants and config header
