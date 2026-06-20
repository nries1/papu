#!/usr/bin/env python3
"""
Enroll a face into the vision worker.

Two modes:
  Webcam  — captures N live frames from the camera
  Photos  — reads images from a directory or explicit file list

Usage:
  python learn_face.py Alice --broker <ip>
  python learn_face.py Alice --broker <ip> --samples 30
  python learn_face.py "John Doe" --broker <ip> --images /path/to/johns/photos/
  python learn_face.py "John Doe" --broker <ip> --images img1.jpg img2.png img3.jpg
"""
import argparse
import base64
import json
import logging
import os
import time
from pathlib import Path

import cv2
import paho.mqtt.client as mqtt

TOPIC_LEARN = "robot/vision/learn"
WARMUP_FRAMES = 15
ENROLLMENT_FRAMES = 20
ENROLLMENT_INTERVAL = 0.15

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff", ".tif"}


def parse_args():
    p = argparse.ArgumentParser(description="Enroll a face into the vision worker")
    p.add_argument("name", help="Name to associate with the face")
    p.add_argument("--broker", required=True, help="MQTT broker IP or hostname")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--images", nargs="+", metavar="PATH",
                   help="Image files or a single directory to use instead of the webcam")
    p.add_argument("--camera", type=int, default=0, help="Camera index (webcam mode only)")
    p.add_argument("--samples", type=int, default=ENROLLMENT_FRAMES,
                   help="Number of frames to capture (webcam mode only)")
    p.add_argument("--quality", type=int, default=95, help="JPEG re-encode quality")
    return p.parse_args()


def collect_image_paths(paths: list[str]) -> list[Path]:
    result = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in IMAGE_EXTENSIONS:
                    result.append(f)
        elif p.is_file():
            if p.suffix.lower() in IMAGE_EXTENSIONS:
                result.append(p)
            else:
                raise ValueError(f"Unsupported image format: {p}")
        else:
            raise FileNotFoundError(f"Not found: {p}")
    return result


def load_image_as_jpeg(path: Path, quality: int) -> bytes | None:
    img = cv2.imread(str(path))
    if img is None:
        return None
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else None


def capture_webcam_frames(camera: int, samples: int) -> list[bytes]:
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera index {camera}")

    log = logging.getLogger(__name__)
    log.info("Warming up camera (%d frames)…", WARMUP_FRAMES)
    for _ in range(WARMUP_FRAMES):
        cap.read()
        time.sleep(0.05)

    log.info("Capturing %d sample(s) — move your head slightly between shots…", samples)
    frames = []
    for i in range(samples):
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame %d capture failed — skipping", i)
            continue
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if ok:
            frames.append(buf.tobytes())
        if i < samples - 1:
            time.sleep(ENROLLMENT_INTERVAL)
    cap.release()
    return frames


def publish_frames(name: str, jpeg_frames: list[bytes], broker: str, port: int) -> int:
    client = mqtt.Client(client_id="robot-vision-enroll")
    client.connect(broker, port, keepalive=60)
    client.loop_start()

    sent = 0
    for jpeg in jpeg_frames:
        payload = json.dumps({
            "name": name,
            "frame": base64.b64encode(jpeg).decode("utf-8"),
        })
        info = client.publish(TOPIC_LEARN, payload, qos=1)
        info.wait_for_publish()
        sent += 1
    client.loop_stop()
    client.disconnect()
    return sent


def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    log = logging.getLogger(__name__)

    if args.images:
        image_paths = collect_image_paths(args.images)
        if not image_paths:
            raise RuntimeError("No valid image files found in the provided paths")
        log.info("Found %d image(s) to enroll for '%s'", len(image_paths), args.name)
        jpeg_frames = []
        for path in image_paths:
            data = load_image_as_jpeg(path, args.quality)
            if data is None:
                log.warning("Could not read %s — skipping", path)
                continue
            jpeg_frames.append(data)
            log.info("  Loaded %s", path.name)
    else:
        jpeg_frames = capture_webcam_frames(args.camera, args.samples)

    if not jpeg_frames:
        raise RuntimeError("No frames to enroll")

    sent = publish_frames(args.name, jpeg_frames, args.broker, args.port)
    log.info("Enrolled %d frame(s) for '%s'", sent, args.name)


if __name__ == "__main__":
    main()
