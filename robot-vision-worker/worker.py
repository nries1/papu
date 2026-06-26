#!/usr/bin/env python3
"""
Robot vision worker — subscribes to MQTT webcam frames, runs face_recognition
with CUDA (dlib CNN model), and publishes structured JSON results.

Topics consumed:
  robot/vision/frame  — raw JPEG bytes at ~10 fps from publisher
  robot/vision/learn  — JSON {"name": str, "frame": base64-JPEG} to enroll a face

Topics produced:
  robot/vision/result — JSON result per frame (see build_result())
"""
import os
import io
import json
import logging
import pickle
import base64
import queue
import threading
import time
from datetime import datetime, timezone

import numpy as np
import paho.mqtt.client as mqtt
from PIL import Image
import face_recognition

MQTT_HOST = os.environ.get("MQTT_BROKER_HOST", "mqtt-broker")
MQTT_PORT = int(os.environ.get("MQTT_BROKER_PORT", 1883))

TOPIC_FRAME = "robot/vision/frame"
TOPIC_LEARN = "robot/vision/learn"
TOPIC_RESULT = "robot/vision/result"

KNOWN_FACES_DIR = os.environ.get("KNOWN_FACES_DIR", "/app/known_faces")
PKL_PATH = os.path.join(KNOWN_FACES_DIR, "encodings.pkl")

# Faces whose distance is above this threshold are reported as "unknown".
RECOGNITION_THRESHOLD = float(os.environ.get("RECOGNITION_THRESHOLD", "0.55"))

known_encodings: list = []
known_names: list[str] = []

# 1-slot buffer: on_message always overwrites with the newest frame so the
# processing thread never works on stale data.
_frame_queue: queue.Queue = queue.Queue(maxsize=1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Known-face persistence
# ---------------------------------------------------------------------------

def load_known_faces() -> None:
    global known_encodings, known_names
    if not os.path.exists(PKL_PATH):
        log.info("No encodings file found — starting with no known faces")
        return
    with open(PKL_PATH, "rb") as f:
        data = pickle.load(f)
    known_encodings = data.get("encodings", [])
    known_names = data.get("names", [])
    log.info("Loaded %d known face(s): %s", len(known_names), known_names)


def save_known_faces() -> None:
    os.makedirs(KNOWN_FACES_DIR, exist_ok=True)
    with open(PKL_PATH, "wb") as f:
        pickle.dump({"encodings": known_encodings, "names": known_names}, f)


# ---------------------------------------------------------------------------
# Frame helpers
# ---------------------------------------------------------------------------

def jpeg_to_rgb(payload: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(payload)).convert("RGB"))


def pan_tilt_delta(
    loc: tuple[int, int, int, int], frame_w: int, frame_h: int
) -> tuple[float, float]:
    """Return (pan, tilt) in [-0.5, 0.5].  Positive pan = right, positive tilt = down."""
    top, right, bottom, left = loc
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    return (
        round((cx - frame_w / 2) / frame_w, 4),
        round((cy - frame_h / 2) / frame_h, 4),
    )


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------

def process_frame(payload: bytes) -> dict:
    rgb = jpeg_to_rgb(payload)
    frame_h, frame_w = rgb.shape[:2]

    # CNN model uses the GPU when dlib was compiled with DLIB_USE_CUDA=1.
    locations = face_recognition.face_locations(rgb, model="cnn")
    encodings = face_recognition.face_encodings(rgb, locations)

    faces = []
    for enc, loc in zip(encodings, locations):
        name = "unknown"
        confidence = 0.0

        if known_encodings:
            distances = face_recognition.face_distance(known_encodings, enc)
            best_idx = int(np.argmin(distances))
            best_dist = float(distances[best_idx])
            confidence = round(max(0.0, 1.0 - best_dist), 4)
            if best_dist <= RECOGNITION_THRESHOLD:
                name = known_names[best_idx]

        top, right, bottom, left = loc
        pan, tilt = pan_tilt_delta(loc, frame_w, frame_h)
        faces.append(
            {
                "name": name,
                "confidence": confidence,
                "bbox": {
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "left": left,
                },
                "pan_delta": pan,
                "tilt_delta": tilt,
            }
        )

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "frame_width": frame_w,
        "frame_height": frame_h,
        "faces": faces,
    }


def handle_learn(payload: bytes) -> None:
    global known_encodings, known_names
    try:
        data = json.loads(payload)
        name: str = data["name"]
        frame_bytes = base64.b64decode(data["frame"])
    except (json.JSONDecodeError, KeyError, Exception) as e:
        log.error("Invalid learn payload: %s", e)
        return

    rgb = jpeg_to_rgb(frame_bytes)
    locations = face_recognition.face_locations(rgb, model="cnn")
    if not locations:
        log.warning("No face detected in enrollment frame for '%s' — skipping", name)
        return

    encodings = face_recognition.face_encodings(rgb, locations)
    known_encodings.append(encodings[0])
    known_names.append(name)
    save_known_faces()
    log.info("Enrolled '%s' — total known faces: %d", name, len(known_names))


# ---------------------------------------------------------------------------
# MQTT callbacks
# ---------------------------------------------------------------------------

def on_connect(client, userdata, flags, rc):
    if rc != 0:
        log.error("MQTT connect failed, rc=%d", rc)
        return
    log.info("Connected to MQTT broker %s:%d", MQTT_HOST, MQTT_PORT)
    client.subscribe(TOPIC_FRAME, qos=0)
    client.subscribe(TOPIC_LEARN, qos=1)
    log.info("Subscribed to %s and %s", TOPIC_FRAME, TOPIC_LEARN)


def on_message(client, userdata, msg):
    if msg.topic == TOPIC_FRAME:
        try:
            _frame_queue.get_nowait()  # drop stale frame if one is waiting
        except queue.Empty:
            pass
        _frame_queue.put_nowait(msg.payload)

    elif msg.topic == TOPIC_LEARN:
        handle_learn(msg.payload)


def processing_loop(client: mqtt.Client) -> None:
    while True:
        frame = _frame_queue.get()
        try:
            result = process_frame(frame)
            client.publish(TOPIC_RESULT, json.dumps(result), qos=0)
            if result["faces"]:
                names = [f["name"] for f in result["faces"]]
                log.info("Detected %d face(s): %s", len(names), names)
        except Exception as e:
            log.error("Frame processing error: %s", e)


_disconnect_event = threading.Event()

def on_disconnect(client, userdata, rc):
    if rc != 0:
        log.warning("Unexpected MQTT disconnect, rc=%d", rc)
    _disconnect_event.set()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    load_known_faces()

    client = mqtt.Client(client_id="robot-vision-worker", clean_session=False)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect

    threading.Thread(target=processing_loop, args=(client,), daemon=True).start()

    while True:
        try:
            _disconnect_event.clear()
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            client.loop_start()
            _disconnect_event.wait()  # blocks until on_disconnect fires
            client.loop_stop()
        except Exception as e:
            log.error("Connection error: %s — retrying in 5s", e)
            client.loop_stop()
        log.warning("MQTT loop exited — retrying in 5s")
        time.sleep(5)


if __name__ == "__main__":
    main()
