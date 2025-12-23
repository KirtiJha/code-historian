/**
 * esbuild configuration for Code Historian
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Simple copy function for media files
function copyMediaFiles(): void {
  const mediaDir = './media';
  const distMediaDir = './dist/media';
  
  if (fs.existsSync(mediaDir)) {
    if (!fs.existsSync(distMediaDir)) {
      fs.mkdirSync(distMediaDir, { recursive: true });
    }
    
    const files = fs.readdirSync(mediaDir);
    for (const file of files) {
      fs.copyFileSync(path.join(mediaDir, file), path.join(distMediaDir, file));
    }
    console.log('Media files copied');
  }
}

// Common options
const commonOptions: esbuild.BuildOptions = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
  platform: 'node',
  target: 'node18',
};

// Extension build
async function buildExtension(): Promise<void> {
  const ctx = await esbuild.context({
    ...commonOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    format: 'cjs',
    external: [
      'vscode',
      'better-sqlite3',
      '@anthropic-ai/sdk',
      '@google/generative-ai',
      'vectordb',
    ],
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching extension...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

// Webview build
async function buildWebview(): Promise<void> {
  const ctx = await esbuild.context({
    entryPoints: ['src/webview/index.ts'],
    outfile: 'dist/webview.js',
    bundle: true,
    minify: production,
    sourcemap: !production,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    loader: {
      '.css': 'css',
    },
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"',
    },
    jsx: 'automatic',
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching webview...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

// Run builds
async function main(): Promise<void> {
  try {
    // Copy media files first
    copyMediaFiles();
    
    await Promise.all([
      buildExtension(),
      buildWebview(),
    ]);
    
    if (!watch) {
      console.log('Build completed successfully!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

main();
