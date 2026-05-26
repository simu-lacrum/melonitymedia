#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Master Key Rotation Script
//
// Usage: node scripts/rotate-master-key.mjs <old-base64-key> <new-base64-key>
//
// This script:
// 1. Reads all encrypted cookies from the database
// 2. Decrypts each with the OLD key
// 3. Re-encrypts each with the NEW key
// 4. Updates the database row
// 5. Reports success/failure per account
//
// IMPORTANT:
// - Run during maintenance window (no active uploads)
// - After success, update MASTER_KEY in .env and restart all services
// - Keep the old key stored securely until you verify all accounts work
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [oldKeyB64, newKeyB64] = process.argv.slice(2);

  if (!oldKeyB64 || !newKeyB64) {
    console.error('Usage: node scripts/rotate-master-key.mjs <old-base64-key> <new-base64-key>');
    console.error('  Generate new key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
  }

  const oldKey = Buffer.from(oldKeyB64, 'base64');
  const newKey = Buffer.from(newKeyB64, 'base64');

  if (oldKey.length !== 32) {
    console.error('ERROR: Old key must be 32 bytes (base64 encoded)');
    process.exit(1);
  }

  if (newKey.length !== 32) {
    console.error('ERROR: New key must be 32 bytes (base64 encoded)');
    process.exit(1);
  }

  console.log('🔄 Starting master key rotation...\n');

  // Fetch all accounts with encrypted cookies
  const accounts = await prisma.socialAccount.findMany({
    where: {
      cookiesEncrypted: { not: null },
      cookiesIv: { not: null },
      cookiesAuthTag: { not: null },
    },
    select: {
      id: true,
      username: true,
      cookiesEncrypted: true,
      cookiesIv: true,
      cookiesAuthTag: true,
    },
  });

  console.log(`Found ${accounts.length} accounts with encrypted cookies\n`);

  let success = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      // Decrypt with old key
      const decipher = crypto.createDecipheriv('aes-256-gcm', oldKey, account.cookiesIv);
      decipher.setAuthTag(account.cookiesAuthTag);
      const decrypted = Buffer.concat([
        decipher.update(account.cookiesEncrypted),
        decipher.final(),
      ]);

      // Re-encrypt with new key
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(decrypted),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // Update database
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          cookiesEncrypted: encrypted,
          cookiesIv: iv,
          cookiesAuthTag: authTag,
        },
      });

      console.log(`  ✅ ${account.id} (${account.username ?? 'unnamed'})`);
      success++;
    } catch (err) {
      console.error(`  ❌ ${account.id} (${account.username ?? 'unnamed'}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Rotation complete: ${success} success, ${failed} failed`);

  if (failed > 0) {
    console.error('\n⚠️  Some accounts failed. DO NOT update MASTER_KEY in .env yet.');
    console.error('    Investigate failures, then re-run with the same keys.');
    process.exit(1);
  }

  console.log('\n✅ All accounts rotated successfully.');
  console.log('   Next steps:');
  console.log('   1. Update MASTER_KEY in .env to the new key');
  console.log('   2. Restart all services (docker compose restart api worker)');
  console.log('   3. Store old key securely for 30 days (rollback window)');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
