# @mrz-scanner/cli

Command-line tool that runs the full MRZ scanner pipeline over document
images and writes the parsed fields as JSON. Installed as the `mrz2json`
binary.

## Install / Build

```bash
pnpm install
pnpm --filter @mrz-scanner/cli build
```

Run directly:

```bash
node packages/mrz-cli/dist/cli.js passport.jpg
```

Or link globally (`pnpm link --global`) to get `mrz2json` on `$PATH`.

## Usage

```
mrz2json [options] <file...>

Options:
  -d, --dest-dir <path>   Output directory for JSON files (must exist, must be under cwd)
  -f, --format <type>     Output format: json (default) or text
  -c, --confidence        Include per-character confidence scores in the JSON
  -h, --help              Show help
  -v, --version           Show version
```

### Examples

```bash
# Write passport.jpg.mrz.json next to each input
mrz2json a.jpg b.png c.jpeg

# Collect every JSON into out/
mkdir -p out && mrz2json -d out *.jpg

# Print the raw MRZ lines to stdout (no file is written)
mrz2json -f text passport.jpg

# Include confidence scores in the JSON
mrz2json -c passport.jpg
```

Output JSON contains the parsed fields flat at the top level (whatever the
`mrz` package produces) plus:

- `_fixed: true` when OCR-confusion corrections were applied.
- `_confidence: number[][]` when `-c` was passed.

## Security

- Input files above 50 MB are rejected before decoding.
- `--dest-dir` is resolved and forced to stay under the working directory;
  absolute paths that escape cwd are rejected, as are path-traversal
  components.
- Output JSON files are written with mode `0600` (owner read/write only).
- On parse failure, raw OCR text is not echoed to stderr — it can contain
  partial PII.

## Exit codes

- `0` — all files processed successfully.
- `1` — one or more files failed (the CLI still attempts every remaining
  file and reports each failure on stderr).

## License

AGPL-3.0-or-later.
