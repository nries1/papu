#!/usr/bin/env node
// Usage: node scripts/log_release.js [--version <v>] [--model <name>]
//
// Records a hardware release in the `hardware_releases` table by running psql
// inside the `home-db-1` Postgres container. Cross-platform replacement for the
// old log_release.sh, so the `*:flash` npm scripts behave identically on
// Windows and macOS.
//
// Logging is best-effort: if Docker or the DB isn't reachable (e.g. flashing
// from a laptop that isn't the server), it warns and exits 0 so a successful
// upload can still proceed to the serial monitor.
//
// TODO: This logs via `docker exec` against a LOCAL `home-db-1` container, so
// releases flashed from a dev machine (where the DB doesn't run) are never
// recorded. To capture those, point this at the server's DB instead — e.g. an
// API endpoint or a remote psql connection (PGHOST/PGPORT) to the server.

const { spawnSync } = require('child_process');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const version = arg('--version') || `v1.0.${Math.floor(Date.now() / 1000)}`;
const model   = arg('--model') || 'Unknown ESP32';

const sqlEscape = (s) => s.replace(/'/g, "''");

const sql =
  'INSERT INTO hardware_releases (version_string, hardware_model, notes, uploaded_by) ' +
  `VALUES ('${sqlEscape(version)}', '${sqlEscape(model)}', 'Automated upload via flash script', 'nries1');`;

console.log(`Logging release ${version} (${model}) to hardware_releases table...`);

// No shell, so the SQL string is passed as a single argv element — avoids
// cross-platform quoting issues. `docker` is a real .exe, found on PATH on both
// platforms. Dropped the old `-it` flags: no TTY is needed for a one-off `-c`.
const result = spawnSync(
  'docker',
  ['exec', 'home-db-1', 'psql', '-U', 'user', '-d', 'plants', '-c', sql],
  { stdio: 'inherit' }
);

if (result.error || result.status !== 0) {
  console.warn('⚠  Could not log release (Docker/DB unavailable?) — continuing anyway.');
}
process.exit(0);
