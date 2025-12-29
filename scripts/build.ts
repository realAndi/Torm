#!/usr/bin/env bun
/**
 * Cross-platform build script for Torm
 *
 * Compiles standalone executables for macOS, Windows, and Linux
 */

import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const VERSION = process.env.VERSION || '0.1.0';
const ENTRY_POINT = './src/cli/index.tsx';
const OUT_DIR = './dist/releases';

interface Target {
  name: string;
  target: string;
  outfile: string;
}

const targets: Target[] = [
  // macOS
  { name: 'macOS ARM64', target: 'bun-darwin-arm64', outfile: `torm-${VERSION}-darwin-arm64` },
  { name: 'macOS x64', target: 'bun-darwin-x64', outfile: `torm-${VERSION}-darwin-x64` },
  // Linux
  { name: 'Linux x64', target: 'bun-linux-x64', outfile: `torm-${VERSION}-linux-x64` },
  { name: 'Linux ARM64', target: 'bun-linux-arm64', outfile: `torm-${VERSION}-linux-arm64` },
  // Windows
  { name: 'Windows x64', target: 'bun-windows-x64', outfile: `torm-${VERSION}-windows-x64.exe` },
];

async function build() {
  console.log(`Building Torm v${VERSION}\n`);

  // Create output directory
  if (!existsSync(OUT_DIR)) {
    await mkdir(OUT_DIR, { recursive: true });
  }

  const results: { target: string; success: boolean; error?: string }[] = [];

  for (const { name, target, outfile } of targets) {
    console.log(`Building ${name}...`);
    const outPath = `${OUT_DIR}/${outfile}`;

    try {
      await $`bun build ${ENTRY_POINT} --compile --minify --target=${target} --outfile=${outPath}`.quiet();
      console.log(`  ✓ ${outPath}`);
      results.push({ target: name, success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ Failed: ${errorMsg}`);
      results.push({ target: name, success: false, error: errorMsg });
    }
  }

  // Summary
  console.log('\n--- Build Summary ---');
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Successful: ${successful}/${results.length}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}/${results.length}`);
    results.filter((r) => !r.success).forEach((r) => console.log(`  - ${r.target}: ${r.error}`));
  }

  // List output files
  console.log(`\nOutput directory: ${OUT_DIR}`);
  if (existsSync(OUT_DIR)) {
    const files = await $`ls -lh ${OUT_DIR}`.text();
    console.log(files);
  }
}

build().catch(console.error);
