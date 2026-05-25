// ─────────────────────────────────────────────────────────────
// Plugin Registry
//
// Manages the ordered list of video processing plugins.
// Plugins run in sequence: each receives the previous output.
//
// Usage:
//   registry.register(new FFmpegUniqualizePlugin());
//   const outputPath = await registry.run(inputVideoPath);
// ─────────────────────────────────────────────────────────────

import { BasePlugin } from './base-plugin.js';

class PluginRegistry {
  private plugins: BasePlugin[] = [];

  /** Register a plugin to the pipeline */
  register(plugin: BasePlugin): void {
    console.log(`[Plugins] Registered: ${plugin.name} — ${plugin.description}`);
    this.plugins.push(plugin);
  }

  /** Run all plugins in sequence */
  async run(inputPath: string): Promise<string> {
    let currentPath = inputPath;

    for (const plugin of this.plugins) {
      console.log(`[Plugins] Running: ${plugin.name}`);
      currentPath = await plugin.process(currentPath);
    }

    return currentPath;
  }

  /** Cleanup all plugins */
  async cleanup(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.cleanup();
    }
  }

  /** Get list of registered plugin names */
  list(): string[] {
    return this.plugins.map(p => p.name);
  }
}

// Singleton registry — shared across all worker handlers
export const pluginRegistry = new PluginRegistry();

// ── Register plugins here ──────────────────────────────────
// import { FFmpegUniqualizePlugin } from './ffmpeg-uniqualize/index.js';
// pluginRegistry.register(new FFmpegUniqualizePlugin());
