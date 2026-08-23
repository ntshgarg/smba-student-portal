# `public/fonts/` — single-glyph currency subsets

Three woff2 files, about 1 KB each. Each contains exactly one glyph: `₹`
(U+20B9, the Indian rupee sign). They are not general-purpose webfonts and
must not be used as one — they have no other characters in them.

## Why they exist

`app/layout.tsx` loads Manrope and Newsreader through `next/font/google` with
`subsets: ["latin"]`. That option controls **preloading only** — next/font still
emits an `@font-face` rule for all six subsets Google publishes. `₹` lives in
`latin-ext`, not `latin`, and it is the only character in the whole application
outside `latin`. So the browser downloaded an entire `latin-ext` file per family
the moment any currency string painted, to draw that one symbol: 15 KB on `/`,
40 KB on `/player` and `/coach`, 52 KB on `/coach/financials/records`.

`app/globals.css` re-declares `U+20B9` for the same families, pointing at these
files. next/font's stylesheet is emitted before `globals.css`, and within a family
the last rule declared wins an overlapping `unicode-range`, so these win the match
and the `latin-ext` files are never requested.

Because each file is subset from the very font next/font resolved, the rendered
symbol is byte-for-byte the same pixels as before — verified across the weights and
sizes the app actually uses. The variable 200-800 weight axis is preserved.

## Inventory

| file | family / style | upstream Google subset file | bytes |
| --- | --- | --- | --- |
| `manrope-normal-rupee.woff2` | Manrope normal | `6ab0db14f70d8ed6-s.13hnt-xgp82zk.woff2` (15240 B) | 1032 |
| `newsreader-italic-rupee.woff2` | Newsreader italic | `e62850744c7f266e-s.0n7ulcr4ivksg.woff2` (39708 B) | 1200 |
| `newsreader-normal-rupee.woff2` | Newsreader normal | `750c737482d9de2f-s.3ex3j6ahhvjry.woff2` (36328 B) | 1212 |

The upstream column is the content-hashed `latin-ext` file next/font emitted into
.next/static/media at the time of generation. It changes when the Google font
version changes, which is the signal to regenerate.

## Regenerating

These are build artifacts checked into the repository, so they do not update
themselves. Regenerate whenever Manrope or Newsreader changes version:

```sh
# against any tree with a completed `next build`
node output/perf-rupee/build-rupee-css.mjs . \
  --assets public/fonts --write app/globals.css
```

It rewrites both these files and the generated block in `app/globals.css`.
Requires `pyftsubset` (fonttools + brotli); the generator header says where.

If they are ever deleted or go stale, nothing breaks visually: the `@font-face`
rules simply fail to load and Blink falls back to next/font's own `latin-ext`
rule, which is the pre-optimisation behaviour — correct glyph, more bytes.
