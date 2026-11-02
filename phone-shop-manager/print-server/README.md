# Print server

Local HTTP server that puts ink on paper: ESC/POS receipts on a thermal POS
printer, TSPL stickers on a label printer. It runs on the till — either in-process
inside the Electron desktop app (this `server.js`, required by `electron/main.cjs`
and called directly over IPC) or standalone (`npm run print-server`, used by the
browser app). There is exactly one copy of this file; the shell loads it from
`resources/print-server/` when packaged and from this directory in development.

Because it writes to firmware, it is **closed by default**:

| Gate | Default | Consequence |
| --- | --- | --- |
| Bind address | `127.0.0.1` | Only the till itself can reach it. |
| Browser origins | hosted app origin + `localhost`/`127.0.0.1` | A random webpage in the shop cannot print. |
| Non-browser clients | `X-Print-Token` required | curl/scripts need the token. |
| `/status` | printer names only after authorization | Queue names are not public. |
| Text fields | sanitized before the command stream | No TSPL/ESC-POS injection. |
| Jobs | one at a time, max 12 waiting | No interleaved spool output, no unbounded queue. |
| CUPS | hard timeouts, exact queue match, no default-printer fallback | Never silently prints on the wrong machine. |

Remote printing between devices does **not** use this HTTP port — it goes through
the Firestore `printQueue` collection, consumed by `src/hooks/usePrintQueue.ts`,
which then calls the local server. Loopback binding therefore costs no feature.

## Authorization

A browser sends `Origin` itself and a page cannot forge it, so the Origin
allowlist is the real barrier against "any tab open on this machine". A
non-browser client has no Origin, so it presents a token:

```
curl -X POST http://127.0.0.1:3355/print-receipt \
  -H 'Content-Type: application/json' \
  -H "X-Print-Token: $(cat ~/.phone-shop-print-server/token)" \
  -d @job.json
```

With no `PRINT_SERVER_TOKEN` set, the server generates one on first start and
stores it mode `0600` at `~/.phone-shop-print-server/token`. The startup banner
prints the path, never the value.

Electron's IPC path bypasses HTTP entirely and is trusted by construction.

## Endpoints

`GET /status` · `POST /print-receipt` · `POST /print-repair-label` ·
`POST /print-repair-ticket` · `POST /print-z-report` ·
`POST /print-low-stock-report` · `POST /print-barcode` ·
`POST /print-custom-ticket` · `POST /calibrate-labels`

All errors are JSON: `{ ok: false, error, code? }`. `401` = missing token,
`403` = origin not allowed, `404` = unknown path, `400` = bad payload,
`429` = rate limit or full queue (with `Retry-After`), `502` = the target CUPS
queue does not exist.

## Configuration

`.env.example` documents every flag. The ones that change behavior a shop will
notice:

- `PRINT_SERVER_LAN_MODE=1` — bind `0.0.0.0` and trust private-range origins, so
  another device can POST directly. Prefer the Firestore queue; this opens the
  port to the whole network.
- `PRINT_SERVER_ALLOWED_ORIGINS=https://…` — add a browser origin.
- `PRINT_SERVER_TOKEN=…` — pin the token instead of the generated file.
- `PRINT_SERVER_ALLOW_UNAUTHENTICATED=1` — turn authorization off (the pre-2.0
  behavior). Only for a machine with no other use.
- `PRINT_SERVER_ALLOW_DEFAULT_PRINTER=1` — re-enable the fallback that sends a
  job to the system default queue when the configured one is missing.
- `PRINT_SERVER_MAX_COPIES`, `PRINT_SERVER_MAX_LABELS_PER_JOB`,
  `PRINT_SERVER_MAX_QUEUE_DEPTH`, `PRINT_SERVER_LPR_TIMEOUT_MS` — the paper and
  hanging guards.

A misconfigured limit that blocks a real job is an ops incident, not a code
change: set the env value, restart, done.

## Sanitizing

`sanitizePayload` strips C0 control bytes from every string in the body before a
handler sees it, keeping `\n` and `\t` because ticket layout splits free text on
newlines and aligns columns with tabs. Base64 image keys (`logo`, `image`, …) are
passed through untouched — they feed the raster encoder, not the command stream.
PNG dimensions are read from the IHDR header and refused past
`PRINT_SERVER_MAX_LOGO_PIXELS` before decoding.

For TSPL, which is line-based and quotes its fields, `tsplText` additionally drops
`"` and `\` and collapses a value to one line; `tsplField` does the same without
collapsing the inner spacing that keeps two columns aligned. `clampCopies` bounds
`copies` to `PRINT_SERVER_MAX_COPIES`, so `NaN` and `1e9` both stop at the cap
instead of meaning "1e9 sheets".

## Development

```
npm start              # standalone
npm test               # node --test security.test.js — 20 tests
```

`security.test.js` never sends a valid print payload: every request uses a body
the handler rejects before reaching CUPS, so no test can put paper in a printer.
It covers the bind default, origin/token gating, the sanitizer invariants, the
copies and batch caps, queue and rate-limit responses, JSON error shapes, and
`/status` name hiding.

This `server.js` is the only copy of the print server. `electron/print-raw.ps1`
is a generated copy of `print-raw.ps1`, kept only because the packaging config
copies it into `resources/scripts/`; regenerate with `npm run sync:print-script`
and guard against drift with `npm run check:print-sync`.

**Not verifiable here:** real ESC/POS receipts, real TSPL labels, and the Windows
`print-raw.ps1` branch. They need the physical printers. The tests above prove the
command stream is well-formed and the guards hold; they do not prove a given
printer likes the output.

`cors` remains in `dependencies` but is no longer used — the hand-written
allowlist replaced it.
