#!/bin/bash
# Enroll a face and register its display name.
# Usage: npm run vision:enroll -- <userId> <name> <photos-dir>
#   userId     — recognition ID stored in encodings.pkl (e.g. nries1)
#   name       — display name shown in the UI (e.g. nico)
#   photos-dir — path to a directory of photos (jpg/png)

set -e

USERID=$1
NAME=$2
PHOTOS=$3

if [ -z "$USERID" ] || [ -z "$NAME" ] || [ -z "$PHOTOS" ]; then
  echo "Usage: npm run vision:enroll -- <userId> <name> <photos-dir>"
  echo ""
  echo "  userId     — recognition ID (e.g. nries1)"
  echo "  name       — display name shown in the UI (e.g. nico)"
  echo "  photos-dir — directory of photos to enroll from"
  exit 1
fi

echo "Enrolling face for '$USERID' (display: '$NAME') from $PHOTOS ..."
.venv/bin/python robot-vision-publisher/learn_face.py "$USERID" \
  --broker 100.122.11.16 --port 1883 --images "$PHOTOS"

echo "Registering display name in database ..."
docker compose exec -T db psql -U user -d plants -c \
  "INSERT INTO users (email, display_name) VALUES ('$USERID', '$NAME') ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name;"

echo "Done. '$USERID' enrolled and mapped to display name '$NAME'."
