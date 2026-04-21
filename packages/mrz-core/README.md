# @mrz-scanner/core

Types, MRZ parsing, and OCR error correction. Thin wrapper around the
[`mrz`](https://www.npmjs.com/package/mrz) package that retries parsing with
field-aware substitutions when validation fails.

## Install

```bash
pnpm add @mrz-scanner/core
```

## Usage

```ts
import { parse } from '@mrz-scanner/core';

const lines = [
  'P<GABORIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36GAB7408122F1204159ZE184226B<<<<<14',
];

const result = parse(lines);
if (result.valid) {
  console.log(result.fields);  // { firstName, lastName, nationality, ... }
}
// result.modified (optional): corrected lines, present only when corrections were applied
```

## How error correction works

When `mrz.parse()` reports invalid fields, `parse()` inspects each failing
field's `label` to decide the class of confusion to fix:

| Field kind (matched on label) | Substitutions applied |
|---|---|
| `date`, `digit`, `number`, `check` | `O→0`, `l|I→1`, `S→5`, `g→9`, `B→8`, `Z→2`, `D→0` |
| `name`, `state`, `nation` | `0→O`, `1→I`, `5→S`, `8→B`, `2→Z` |

Substitutions are applied inside the `ranges` reported by the `mrz` v5
`Details`, and the function recurses on the modified lines until nothing
changes or the MRZ becomes valid. The recursion terminates because each pass
either strictly reduces the substitutable-character count in failing
ranges or leaves the lines untouched.

## Exports

```ts
// re-exports from mrz v5
type ParseResult

// mrz-relax.ts
function parse(mrz: string[], modified?: boolean): ParseResult
// result.modified?: string[]   — set when any substitution was applied

// symbols.ts
const MRZ_SYMBOLS: readonly string[]  // '0'..'9','A'..'Z','<' (37 entries)
const SYMBOL_TO_INDEX: Map<string, number>
const INDEX_TO_SYMBOL: Map<number, string>

// types.ts
type ScanProgress = (stage: 'detecting' | 'ocr' | 'parsing') => void
interface OcrResult       { lines: string[]; confidence?: number[] }
interface DetectionResult { crop: ImageData | ArrayBuffer; debugImages?: Record<string, unknown> }
interface ScanResult      { parsed?: ParseResult; ocrLines?: string[]; error?: Error; modified?: string[] }
```

## License

AGPL-3.0-or-later. See the repository `LICENSE` file.
