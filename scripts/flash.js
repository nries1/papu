#!/usr/bin/env node
// Usage: node scripts/flash.js --project <name> --fqbn <fqbn> [--target upload|monitor]
//
// Uses arduino-cli to detect which port the board is on, then delegates to pio.
// arduino-cli must be installed and on PATH (it's a project prerequisite).

const { execSync, spawnSync } = require('child_process');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const project = arg('--project');
const fqbn    = arg('--fqbn');
const target  = arg('--target') || 'upload';
// flash.js drives the serial workflow, so scope pio to the serial environment.
// Without -e, `pio run --target upload` runs EVERY env — including the OTA env,
// which would then try to push over the network to the COM port and fail.
const env     = arg('--env') || 'usb';

if (!project || !fqbn) {
  console.error('Usage: flash.js --project <name> --fqbn <fqbn> [--target upload|monitor]');
  process.exit(1);
}

// arduino-cli can't identify the exact board model over USB: ESP32-C3/S3 boards
// using the chip's native USB all enumerate as the generic "ESP32 Family Device"
// (esp32:esp32:esp32_family), and UART-bridge boards report no board at all. So
// we match on the core platform (e.g. "esp32:esp32") rather than the full board
// FQBN. Pass --port <COMx> to skip detection (required when several ESP32 boards
// are connected at once).
const core = fqbn.split(':').slice(0, 2).join(':'); // e.g. "esp32:esp32"

let port = arg('--port');
if (port) {
  console.log(`Using port: ${port}`);
} else {
  try {
    const raw = execSync('arduino-cli board list --format json', { encoding: 'utf8' });
    const { detected_ports: ports = [] } = JSON.parse(raw);

    const matches = ports.filter(p =>
      (p.matching_boards || []).some(b => b.fqbn && b.fqbn.startsWith(core))
    );

    if (matches.length === 0) {
      console.error(`No ${core} board detected on any serial port.`);
      console.error('Run "npm run hw:list" to see what is connected, or pass --port <COMx>.');
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Multiple ${core} boards detected — disambiguate with --port <COMx>:`);
      for (const m of matches) {
        console.error(`  ${m.port.address}  (${m.matching_boards[0]?.name || 'unknown'})`);
      }
      process.exit(1);
    }

    port = matches[0].port.address;
    const name = matches[0].matching_boards[0]?.name || core;
    console.log(`Found: ${name}  →  ${port}`);
  } catch (e) {
    console.error('arduino-cli board list failed:', e.message);
    process.exit(1);
  }
}

// Absolute path: the esp32_exception_decoder monitor filter chdir()s into the
// project dir to read build metadata, and a relative -d would get doubled
// against pio's already-changed CWD (e.g. .../environment-sensor/environment-sensor).
const projectDir = path.resolve(__dirname, '..', 'hardware', project);
const isWindows  = process.platform === 'win32';

let cmd, cmdArgs;
if (target === 'upload') {
  cmd     = 'pio';
  cmdArgs = ['run', '-d', projectDir, '-e', env, '--target', 'upload', '--upload-port', port];
} else if (target === 'monitor') {
  cmd     = 'pio';
  cmdArgs = ['device', 'monitor', '-d', projectDir, '-e', env, '--port', port];
} else {
  console.error(`Unknown target: ${target}. Use "upload" or "monitor".`);
  process.exit(1);
}

const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWindows });
process.exit(result.status ?? 0);
