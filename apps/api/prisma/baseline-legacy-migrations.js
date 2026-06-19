const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'migrations');
const migrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (migrations.length <= 1) {
  console.log('[migrate-baseline] Not enough migrations to baseline.');
  process.exit(0);
}

const legacyMigrations = migrations.slice(0, -1);

console.log(
  `[migrate-baseline] Marking ${legacyMigrations.length} legacy migrations as applied. ` +
  `Latest migration remains pending: ${migrations[migrations.length - 1]}`,
);

for (const migration of legacyMigrations) {
  console.log(`[migrate-baseline] Baseline ${migration}`);
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'resolve', '--applied', migration],
    { stdio: 'inherit' },
  );
}
