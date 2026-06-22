#!/usr/bin/env node
// Full flash flow: upload → log release → monitor.
// Fixed args (--project, --fqbn, --model) are set in package.json scripts.
// Pass-through args (--port, --name, --room, --transport, etc.) are appended
// by npm when the user runs: npm run hw:flash -- --port /dev/ttyACM0 --name foo

const { spawnSync } = require('child_process');
const path = require('path');

const node    = process.execPath;
const scripts = __dirname;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const model = arg('--model');
if (!model) {
  console.error('device_flash.js: --model is required');
  process.exit(1);
}

// All args are forwarded to flash.js. It ignores unknown ones (e.g. --model),
// and --name/--room are safely ignored on the monitor step (target !== upload).
const passthrough = process.argv.slice(2);

function run(script, extraArgs) {
  const result = spawnSync(node, [path.join(scripts, script), ...extraArgs], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('flash.js',       ['--target', 'upload',  ...passthrough]);
run('log_release.js', ['--model', model]);

// Give the device time to reboot and re-enumerate its USB CDC port before
// the monitor tries to connect. Native USB boards disconnect briefly on reset.
console.log('Waiting for device to reboot...');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);

run('flash.js',       ['--target', 'monitor', ...passthrough]);
