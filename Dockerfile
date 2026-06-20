FROM ubuntu:latest

# Install dependencies and arduino-cli
RUN apt-get update && apt-get install -y curl python3 python3-pip clang-format
RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

# Setup ESP32 core
RUN arduino-cli core update-index --additional-urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
RUN arduino-cli core install esp32:esp32 --additional-urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

WORKDIR /workspace