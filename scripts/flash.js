#!/usr/bin/env node
// Usage: node scripts/flash.js --project <name> --fqbn <fqbn> [--target upload|monitor]
//
// Uses arduino-cli to detect which port the board is on, then delegates to pio.
// arduino-cli must be installed and on PATH (it's a project prerequisite).

const { execSync, spawnSync } = require('child_process');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const project = arg('--project');
const fqbn    = arg('--fqbn');
const target  = arg('--target') || 'upload';

if (!project || !fqbn) {
  console.error('Usage: flash.js --project <name> --fqbn <fqbn> [--target upload|monitor]');
  process.exit(1);
}

// arduino-cli reports FQBNs without build options (e.g. "esp32:esp32:esp32s3"),
// so strip options before matching.
const baseFqbn = fqbn.split(':').slice(0, 3).join(':');

let port;
try {
  const raw = execSync('arduino-cli board list --format json', { encoding: 'utf8' });
  const { detected_ports: ports = [] } = JSON.parse(raw);

  const match = ports.find(p =>
    (p.matching_boards || []).some(b => b.fqbn && b.fqbn.startsWith(baseFqbn))
  );

  if (!match) {
    console.error(`No board matching FQBN "${fqbn}" found.`);
    console.error('Run "npm run hw:list" to see what is connected.');
    process.exit(1);
  }

  port = match.port.address;
  const name = match.matching_boards[0]?.name || baseFqbn;
  console.log(`Found: ${name}  →  ${port}`);
} catch (e) {
  console.error('arduino-cli board list failed:', e.message);
  process.exit(1);
}

const projectDir = `hardware/${project}`;
const isWindows  = process.platform === 'win32';

let cmd, cmdArgs;
if (target === 'upload') {
  cmd     = 'pio';
  cmdArgs = ['run', '-d', projectDir, '--target', 'upload', '--upload-port', port];
} else if (target === 'monitor') {
  cmd     = 'pio';
  cmdArgs = ['device', 'monitor', '-d', projectDir, '--port', port];
} else {
  console.error(`Unknown target: ${target}. Use "upload" or "monitor".`);
  process.exit(1);
}

const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWindows });
process.exit(result.status ?? 0);
