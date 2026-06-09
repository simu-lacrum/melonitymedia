// ─────────────────────────────────────────────────────────────
// Cleanup Handler — Video File Deletion After Upload
//
// From instructions.md: "все загруженные пользователем видео
// должны моментально удаляться после залива на платформы"
//
// This handler runs after a successful upload job. It deletes
// the video file from disk to prevent server storage overflow.
// Only runs with concurrency: 1 to prevent race conditions.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import fs from 'fs';
import path from 'path';

interface CleanupJobData {
  userId: string;
  videoId: string;
  videoPath: string;
}

export async function cleanupHandler(job: Job<CleanupJobData>): Promise<void> {
  const { userId, videoId, videoPath } = job.data;
  const logger = new SocketLogger(userId);

  try {
    logger.info(`🗑️ Очистка: удаление ${path.basename(videoPath)}...`);

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
      logger.info(`✅ Файл ${path.basename(videoPath)} удалён (ID: ${videoId})`);
    } else {
      logger.warn(`Файл не найден (уже удалён?): ${videoPath}`);
    }

    // Also clean up any thumbnails or temp files in the same directory
    const dir = path.dirname(videoPath);
    const baseName = path.parse(videoPath).name;

    // Look for related files (thumbnails, temp, error screenshots)
    const relatedFiles = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.startsWith(baseName) || f.includes(videoId))
      : [];

    for (const file of relatedFiles) {
      try {
        fs.unlinkSync(path.join(dir, file));
        logger.info(`  ↳ Удалён связанный файл: ${file}`);
      } catch { /* skip locked files */ }
    }

    await job.updateProgress(100);

  } catch (err: unknown) {
    emitWorkerError(logger, videoId, 'cleanup', err);
    // Don't re-throw: cleanup failures are non-critical
    // The file will be cleaned up by a periodic disk sweep
  } finally {
    logger.disconnect();
  }
}
