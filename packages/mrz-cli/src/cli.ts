#!/usr/bin/env node

/**
 * CLI tool for MRZ scanning.
 * Reads document images and outputs parsed MRZ data as JSON.
 *
 * Usage: mrz2json [options] <file...>
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, join, resolve, isAbsolute } from 'node:path';
import process from 'node:process';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const { values, positionals } = parseArgs({
  options: {
    'dest-dir': { type: 'string', short: 'd' },
    format: { type: 'string', short: 'f', default: 'json' },
    confidence: { type: 'boolean', short: 'c', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help) {
  console.log(`
mrz2json - Extract MRZ data from document images

Usage: mrz2json [options] <file...>

Options:
  -d, --dest-dir <path>  Output directory for JSON files (must exist)
  -f, --format <type>    Output format: json (default) or text
  -c, --confidence       Include per-character confidence scores
  -h, --help             Show this help
  -v, --version          Show version
`);
  process.exit(0);
}

if (values.version) {
  console.log('2.0.0');
  process.exit(0);
}

if (positionals.length === 0) {
  console.error('Error: No input files specified. Use --help for usage.');
  process.exit(1);
}

/**
 * Validate and resolve the output directory.
 * Prevents path traversal by ensuring the resolved path is under cwd.
 */
async function validateDestDir(destDir: string): Promise<string> {
  const cwd = process.cwd();
  const resolved = resolve(cwd, destDir);

  // Block absolute paths that escape the working directory
  if (isAbsolute(destDir) && !resolved.startsWith(cwd)) {
    throw new Error(
      `dest-dir must be relative to the working directory. Got: ${destDir}`,
    );
  }

  // Block path traversal
  if (!resolved.startsWith(cwd)) {
    throw new Error(
      `dest-dir escapes working directory via path traversal. Got: ${destDir}`,
    );
  }

  // Verify directory exists
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      throw new Error(`dest-dir is not a directory: ${destDir}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`dest-dir does not exist: ${destDir}`);
    }
    throw e;
  }

  return resolved;
}

async function main() {
  // Validate dest-dir upfront
  let destDir: string | undefined;
  if (values['dest-dir']) {
    destDir = await validateDestDir(values['dest-dir']);
  }

  // Dynamic imports to avoid loading heavy deps if just showing help
  const { decode } = await import('image-js');
  const { scanMrz } = await import('@mrz-scanner/scanner');

  let exitCode = 0;

  for (const filename of positionals) {
    console.error(`\nProcessing ${filename}`);
    const start = performance.now();

    try {
      // Check file size before reading
      const fileStat = await stat(filename);
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(
          `File too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        );
      }

      const imageData = await readFile(filename);
      const image = decode(new Uint8Array(imageData));
      const result = await scanMrz(image);

      if (result.error) {
        throw result.error;
      }

      if (!result.parsed?.valid) {
        // Don't dump raw MRZ data to stderr -- it may contain partial PII
        throw new Error('Could not parse MRZ from this image');
      }

      const output: Record<string, unknown> = {
        ...result.parsed.fields,
      };
      if (result.parsed.modified) {
        output._fixed = true;
      }
      if (values.confidence && result.confidence) {
        output._confidence = result.confidence;
      }

      const json = JSON.stringify(output, null, 2) + '\n';

      if (values.format === 'text') {
        // Plain text: just the MRZ lines
        console.log(result.ocrLines?.join('\n'));
      } else {
        const outFile = destDir
          ? join(destDir, basename(filename) + '.mrz.json')
          : filename + '.mrz.json';
        // Write with restrictive permissions (owner read/write only)
        await writeFile(outFile, json, { mode: 0o600 });
        const elapsed = (performance.now() - start).toFixed(0);
        console.error(`  -> ${outFile} (${elapsed}ms)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  *** Error: ${msg}`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

main();
