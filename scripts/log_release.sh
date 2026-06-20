#!/bin/bash

# Check if a version string was provided
if [ -z "$1" ]; then
  VERSION="v1.0.$(date +%s)"
else
  VERSION=$1
fi

echo "Logging release $VERSION to hardware_releases table..."

# Execute the insert inside the home-db-1 container
docker exec -it home-db-1 psql -U user -d plants -c \
"INSERT INTO hardware_releases (version_string, hardware_model, notes, uploaded_by) \
VALUES ('$VERSION', 'Adafruit Metro ESP32-S3', 'Automated upload via shell script', 'nries1');"