# Write safety

`POST /api/write` is gated per device by `write_enabled`. A device without the key
cannot be written, and `deploy/config.example.json` ships with it set to `false`.
Leave it off until reads and `/api/trace` look right on the real bus.

Both `POST /api/preview` and `POST /api/write` go through `validate_write()` in
`app/server.py`: register known, marked `writable`, space `coil` or `holding`, value
encodable, inside `enum` / `wmin` / `wmax`. The confirmation dialog therefore never
shows a frame that the write would later refuse.

There is no built-in authentication. Anyone who reaches `:8080` can call every
endpoint, so put TLS and an ACL or basic auth on the reverse proxy in front of it.

Endpoints not listed in the README table: `/api/trace/stream`, `/api/config`,
`/api/config/reset`.
