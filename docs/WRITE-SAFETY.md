# Write safety

`POST /api/write` is gated by per-device `write_enabled` (default **false** in
`deploy/config.example.json`). Leave it off until reads and `/api/trace` look good.

There is no built-in authentication. Put TLS and an ACL or basic auth on the
reverse proxy in front of `:8080`.

API endpoints not listed in older README copies: `/api/trace/stream`,
`/api/config`, `/api/config/reset`.

## Known gap (follow-up)

`POST /api/preview` currently checks only `writable` + `encode_write`, while
`POST /api/write` also enforces enum / `wmin` / `wmax` / coil|holding space.
That means the confirm dialog can show a frame that write would later reject.
Shared helper sketch: `app/write_validate.py` on this branch (not yet wired into
`server.py`). Wire both paths through one `validate_write()` before treating
preview as authoritative.
