#!/usr/bin/env node
// Usage: node scripts/flash.js --project <name> --fqbn <fqbn>
//          [--target upload|monitor] [--transport serial|ota]
//          [--name <device>] [--room <room>] [--port <COMx>] [--host <hostname>]
//
// Delegates to pio. Two transports:
//   serial (default) — uses arduino-cli to detect the board's COM port.
//                      arduino-cli must be installed and on PATH.
//   ota              — talks to the device over the network at <name>.local
//                      (espota upload, telnet socket monitor). Requires --name.
//
// --name/--room set the device identity as compile-time build flags (upload only),
// so one sketch can flash multiple sensors, and --name also drives the OTA host:
//   npm run env:upload  -- --name office_env_sensor --room office
//   npm run env:monitor -- --transport ota --name office_env_sensor

const { execSync, spawnSync, spawn } = require('child_process');

// Resolve pio to an absolute path so spawn/spawnSync can find it regardless
// of whether the npm process inherits the user's full shell PATH.
function resolvePio() {
  try { return execSync('which pio', { encoding: 'utf8' }).trim(); } catch {}
  const fallback = require('path').join(require('os').homedir(), '.platformio/penv/bin/pio');
  if (require('fs').existsSync(fallback)) return fallback;
  console.error('Cannot find pio. Install PlatformIO or add it to PATH.');
  process.exit(1);
}
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const project = arg('--project');
const fqbn    = arg('--fqbn');
const target    = arg('--target') || 'upload';
const transport = arg('--transport') || 'serial';
// Scope pio to one environment. Without -e, `pio run --target upload` runs EVERY
// env, mixing the serial and OTA upload paths. Serial work uses [env:usb], OTA
// uses [env:ota]; default accordingly.
const env       = arg('--env') || (transport === 'ota' ? 'ota' : 'usb');
const name      = arg('--name');
const room      = arg('--room');

if (transport !== 'serial' && transport !== 'ota') {
  console.error(`Invalid --transport "${transport}": use "serial" or "ota".`);
  process.exit(1);
}

// These become C string literals via the sketch's stringize macros, so restrict
// them to safe identifier characters (also valid mDNS hostname chars).
for (const [val, flag] of [[name, '--name'], [room, '--room']]) {
  if (val && !/^[A-Za-z0-9_-]+$/.test(val)) {
    console.error(`Invalid ${flag} "${val}": use only letters, digits, hyphens, underscores.`);
    process.exit(1);
  }
}

if (!project || !fqbn) {
  console.error('Usage: flash.js --project <name> --fqbn <fqbn> [--target upload|monitor]');
  process.exit(1);
}

// Resolve where to talk to the board. Serial yields a COM port; OTA yields the
// device's mDNS hostname (<name>.local), used as the espota target and, wrapped
// as socket://host:23, as the telnet monitor port.
let serialPort = null;
let otaHost = null;

if (transport === 'ota') {
  otaHost = arg('--host') || (name ? `${name}.local` : null);
  if (!otaHost) {
    console.error('OTA transport requires --name <device> (or --host <hostname>).');
    process.exit(1);
  }
  console.log(`OTA target: ${otaHost}`);
} else {
  serialPort = arg('--port');
  if (serialPort) {
    console.log(`Using port: ${serialPort}`);
  } else {
    // arduino-cli can't identify the exact board model over USB: ESP32-C3/S3 boards
    // using the chip's native USB all enumerate as the generic "ESP32 Family Device"
    // (esp32:esp32:esp32_family), and UART-bridge boards report no board at all. So
    // we match on the core platform (e.g. "esp32:esp32") rather than the full board
    // FQBN. Pass --port <COMx> to skip detection (required when several ESP32 boards
    // are connected at once).
    const core = fqbn.split(':').slice(0, 2).join(':'); // e.g. "esp32:esp32"
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

      serialPort = matches[0].port.address;
      const boardName = matches[0].matching_boards[0]?.name || core;
      console.log(`Found: ${boardName}  →  ${serialPort}`);
    } catch (e) {
      console.error('arduino-cli board list failed:', e.message);
      process.exit(1);
    }
  }
}

// Absolute path: the esp32_exception_decoder monitor filter chdir()s into the
// project dir to read build metadata, and a relative -d would get doubled
// against pio's already-changed CWD (e.g. .../environment-sensor/environment-sensor).
const projectDir = path.resolve(__dirname, '..', 'hardware', project);
const isWindows  = process.platform === 'win32';

const pio = resolvePio();
let cmd, cmdArgs;
if (target === 'upload') {
  const uploadPort = transport === 'ota' ? otaHost : serialPort;
  cmd     = pio;
  cmdArgs = ['run', '-d', projectDir, '-e', env, '--target', 'upload', '--upload-port', uploadPort];
} else if (target === 'monitor') {
  const monitorPort = transport === 'ota' ? `socket://${otaHost}:23` : serialPort;
  cmd     = pio;
  cmdArgs = ['device', 'monitor', '-d', projectDir, '-e', env, '--port', monitorPort];
} else {
  console.error(`Unknown target: ${target}. Use "upload" or "monitor".`);
  process.exit(1);
}

// Inject device identity as build flags. Upload rebuilds, so the flags take
// effect; monitor doesn't rebuild, so they're harmless there. The sketch's
// stringize macros mean plain tokens (office_env_sensor) become string literals,
// so no quoting is needed.
const childEnv = { ...process.env };
if (target === 'upload') {
  const flags = [];
  if (name) flags.push(`-DDEVICE_NAME=${name}`);
  if (room) flags.push(`-DROOM_NAME=${room}`);
  if (flags.length) {
    childEnv.PLATFORMIO_BUILD_FLAGS = [process.env.PLATFORMIO_BUILD_FLAGS, ...flags]
      .filter(Boolean)
      .join(' ');
    console.log(`Build identity: ${flags.join(' ')}`);
  } else {
    console.warn('No --name/--room given; using firmware defaults (env_sensor / unknown).');
  }
}

// For the monitor target, use spawn (async) instead of spawnSync so the child
// process properly inherits the TTY. spawnSync breaks TTY inheritance for
// interactive programs like pio device monitor when called through npm/node.
if (target === 'monitor') {
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: isWindows, env: childEnv });
  child.on('exit', code => process.exit(code ?? 0));
} else {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWindows, env: childEnv });
  process.exit(result.status ?? 0);
}
