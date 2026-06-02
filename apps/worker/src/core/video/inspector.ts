import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  width: number;
  height: number;
  durationSec: number;
  aspectRatio: number;
}

export async function inspectVideo(filepath: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration',
    '-of', 'json',
    filepath,
  ]);
  const parsed = JSON.parse(stdout) as { streams: Array<{ width: number; height: number; duration: string }> };
  const s = parsed.streams[0];
  if (!s) throw new Error(`[video-inspector] no video stream in ${filepath}`);

  const width = s.width;
  const height = s.height;
  const durationSec = parseFloat(s.duration);

  return {
    width, height, durationSec,
    aspectRatio: width / height,
  };
}

export function isShortsCompatible(meta: VideoMetadata): { ok: boolean; reason?: string; warning?: string } {
  if (meta.durationSec > 180) {
    return { ok: false, reason: `Длительность ${Math.round(meta.durationSec)}s > 180s (3 минуты)` };
  }
  // Hard reject: anything wider than 3:4 (0.75) is not vertical
  if (meta.aspectRatio > 0.75) {
    return { ok: false, reason: `Соотношение сторон ${meta.aspectRatio.toFixed(2)} не вертикальное (нужно ≤ 0.75 = 3:4, идеал 0.5625 = 9:16)` };
  }
  // Soft warning: between 9:16 and 3:4 — works but suboptimal distribution
  if (meta.aspectRatio > 0.5625) {
    return {
      ok: true,
      warning: `Соотношение ${meta.aspectRatio.toFixed(2)} допустимо, но идеальное для Shorts = 0.5625 (9:16). Текущее может снизить охват.`,
    };
  }
  return { ok: true };
}
