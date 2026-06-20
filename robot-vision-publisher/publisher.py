#!/usr/bin/env python3
"""
Robot vision publisher — captures webcam frames and streams JPEG bytes to MQTT.

Run on the MacBook (or any OpenCV-capable machine):
  pip install -r requirements.txt
  python publisher.py --broker <server-ip>

The worker on the server subscribes to robot/vision/frame and publishes
recognition results to robot/vision/result.
"""
import argparse
import json
import logging
import time

import cv2
import paho.mqtt.client as mqtt

TOPIC_FRAME    = "robot/vision/frame"
TOPIC_RESULT   = "robot/vision/result"
TOPIC_TRACKING = "robot/vision/tracking"

# Downscale resolution for fast local face detection
DETECT_W, DETECT_H = 320, 240


def parse_args():
    p = argparse.ArgumentParser(description="Stream webcam frames to MQTT")
    p.add_argument("--broker", required=True, help="MQTT broker IP or hostname")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    p.add_argument("--fps", type=int, default=10, help="Target publish rate")
    p.add_argument("--quality", type=int, default=80, help="JPEG quality (1-100)")
    p.add_argument("--show-results", action="store_true", help="Print recognition results")
    return p.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    log = logging.getLogger(__name__)

    def on_connect(client, userdata, flags, rc):
        log.info("Connected to broker %s:%d", args.broker, args.port)
        if args.show_results:
            client.subscribe(TOPIC_RESULT)

    def on_message(client, userdata, msg):
        if msg.topic == TOPIC_RESULT:
            try:
                import json
                result = json.loads(msg.payload)
                faces = result.get("faces", [])
                if faces:
                    for f in faces:
                        log.info(
                            "  %-12s  conf=%.2f  pan=%+.3f  tilt=%+.3f",
                            f["name"], f["confidence"], f["pan_delta"], f["tilt_delta"],
                        )
                else:
                    log.info("  (no faces)")
            except Exception:
                pass

    client = mqtt.Client(client_id="robot-vision-publisher")
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.broker, args.port, keepalive=60)
    client.loop_start()

    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera index {args.camera}")

    interval = 1.0 / args.fps
    frame_count = 0
    log.info(
        "Streaming camera %d → %s:%d  topic=%s  fps=%d  quality=%d",
        args.camera, args.broker, args.port, TOPIC_FRAME, args.fps, args.quality,
    )

    try:
        while True:
            t0 = time.monotonic()

            ret, frame = cap.read()
            if not ret:
                log.warning("Frame capture failed, skipping")
                time.sleep(0.1)
                continue

            # Fast local face detection for low-latency pan/tilt tracking
            small = cv2.resize(frame, (DETECT_W, DETECT_H))
            gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            boxes = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )
            tracking_faces = []
            for (x, y, w, h) in boxes:
                cx = x + w / 2
                cy = y + h / 2
                tracking_faces.append({
                    "pan_delta":  round((cx - DETECT_W / 2) / DETECT_W, 4),
                    "tilt_delta": round((cy - DETECT_H / 2) / DETECT_H, 4),
                })
            client.publish(TOPIC_TRACKING, json.dumps({"faces": tracking_faces}), qos=0)

            ok, buf = cv2.imencode(
                ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, args.quality]
            )
            if not ok:
                continue

            client.publish(TOPIC_FRAME, buf.tobytes(), qos=0)
            frame_count += 1

            if frame_count % (args.fps * 10) == 0:
                log.info("Published %d frames", frame_count)

            elapsed = time.monotonic() - t0
            remaining = interval - elapsed
            if remaining > 0:
                time.sleep(remaining)

    except KeyboardInterrupt:
        log.info("Stopped after %d frames", frame_count)
    finally:
        cap.release()
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
