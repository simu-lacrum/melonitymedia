// ─────────────────────────────────────────────────────────────
// Plugin System — Extensible Video Processing Pipeline
//
// Architecture for future scalability:
// Video → [Plugin1: FFmpeg uniqualize] → [Plugin2: resize] → Upload
//
// Each plugin implements BasePlugin and registers itself.
// The pipeline runs plugins in order before upload.
//
// Currently empty — structure exists for FFmpeg integration.
// ─────────────────────────────────────────────────────────────

export abstract class BasePlugin {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Process an input file and return the output file path.
   * The next plugin in the chain receives this output as input.
   */
  abstract process(inputPath: string): Promise<string>;

  /**
   * Optional cleanup hook called after pipeline completion.
   * Use for removing intermediate temp files.
   */
  async cleanup(): Promise<void> {
    // Override in subclass if needed
  }
}
