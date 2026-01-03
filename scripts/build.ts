#!/usr/bin/env bun
/**
 * Cross-platform build script for Torm
 *
 * Compiles standalone executables for macOS, Windows, and Linux
 */

import { $ } from 'bun';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Read version from package.json to stay in sync
const packageJson = JSON.parse(await readFile('./package.json', 'utf-8'));
const VERSION = process.env.VERSION || packageJson.version;
const CLI_ENTRY = './src/cli/index.tsx';
const DAEMON_ENTRY = './src/daemon/entry.ts';
const OUT_DIR = './dist/releases';

interface Target {
  name: string;
  target: string;
  cliOutfile: string;
  daemonOutfile: string;
}

const targets: Target[] = [
  // macOS
  {
    name: 'macOS ARM64',
    target: 'bun-darwin-arm64',
    cliOutfile: `torm-${VERSION}-darwin-arm64`,
    daemonOutfile: `tormd-${VERSION}-darwin-arm64`,
  },
  {
    name: 'macOS x64',
    target: 'bun-darwin-x64',
    cliOutfile: `torm-${VERSION}-darwin-x64`,
    daemonOutfile: `tormd-${VERSION}-darwin-x64`,
  },
  // Linux
  {
    name: 'Linux x64',
    target: 'bun-linux-x64',
    cliOutfile: `torm-${VERSION}-linux-x64`,
    daemonOutfile: `tormd-${VERSION}-linux-x64`,
  },
  {
    name: 'Linux ARM64',
    target: 'bun-linux-arm64',
    cliOutfile: `torm-${VERSION}-linux-arm64`,
    daemonOutfile: `tormd-${VERSION}-linux-arm64`,
  },
  // Windows
  {
    name: 'Windows x64',
    target: 'bun-windows-x64',
    cliOutfile: `torm-${VERSION}-windows-x64.exe`,
    daemonOutfile: `tormd-${VERSION}-windows-x64.exe`,
  },
];

async function build() {
  console.log(`Building Torm v${VERSION}\n`);

  // Create output directory
  if (!existsSync(OUT_DIR)) {
    await mkdir(OUT_DIR, { recursive: true });
  }

  const results: { target: string; success: boolean; error?: string }[] = [];

  for (const { name, target, cliOutfile, daemonOutfile } of targets) {
    console.log(`Building ${name}...`);
    const cliOutPath = `${OUT_DIR}/${cliOutfile}`;
    const daemonOutPath = `${OUT_DIR}/${daemonOutfile}`;

    // Build CLI
    try {
      await $`bun build ${CLI_ENTRY} --compile --minify --target=${target} --outfile=${cliOutPath}`.quiet();
      console.log(`  ✓ CLI: ${cliOutPath}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ CLI Failed: ${errorMsg}`);
      results.push({ target: `${name} CLI`, success: false, error: errorMsg });
      continue;
    }

    // Build Daemon
    try {
      await $`bun build ${DAEMON_ENTRY} --compile --minify --target=${target} --outfile=${daemonOutPath}`.quiet();
      console.log(`  ✓ Daemon: ${daemonOutPath}`);
      results.push({ target: name, success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ Daemon Failed: ${errorMsg}`);
      results.push({ target: `${name} Daemon`, success: false, error: errorMsg });
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
