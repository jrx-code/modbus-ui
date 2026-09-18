# Write safety

`POST /api/write` is gated by per-device `write_enabled` (default **false** in
`deploy/config.example.json`). Leave it off until reads and `/api/trace` look good.

`POST /api/preview` uses the **same** validation as write (writable flag, space,
enum, `wmin`/`wmax`) but does not send a frame — so the confirm dialog cannot
offer a value that write would reject.

There is no built-in authentication. Put TLS and an ACL or basic auth on the
reverse proxy in front of `:8080`.

API endpoints not listed in older README copies: `/api/trace/stream`,
`/api/config`, `/api/config/reset`.
