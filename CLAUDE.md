# modbus-ui

Dependency-free Modbus register browser with guarded writes. See `README.md`.
Site-specific deployment values live outside this repo (`/etc/modbus-ui/config.json`).

## Gotchas

- **One Modbus interface occupies three slave addresses.** The Toshiba
  BMS-IFMB1280U-E with SW1=1 answers on 1, 2 and 3. Slave N covers indoor units
  1-64, N+1 covers 65-128, N+2 is reserved (loopback works, register reads return
  exception `0x02`).
- **A missing indoor unit does NOT raise exception `0x07`** — it returns a valid
  frame full of zeros. Presence is detected from the model name string
  (input 30007-30014); sixteen zero bytes means no unit. Hence `absent` in
  `decode()` and the badge in the UI.
- **Address stride differs per space**: 152 for coils/discrete, 156 for
  input/holding. Easy to get wrong when adding registers.
- **Never add a `unit` key to register metadata.** `unit` is the unit of
  measurement (`°C`, `kW`, `h`) used during formatting. Indoor-unit metadata is
  `iu` / `iu_label`. The collision produced
  `TypeError: can only concatenate str (not "int") to str` on every read (2026-09-02).
- **A dead gateway masks decoding bugs.** When the gateway is unreachable the
  exception is raised in the network layer and the decoding path never runs. After
  restoring connectivity always check `journalctl -u modbus-ui`, not just the panel.
- **`.hidden` needs `!important`** — `#modal` / `#auditmodal` are ID selectors and
  outrank a class, so without it both modals render on load.
- **`main` uses `margin: 0 auto`**, and auto margins on the cross axis disable
  `align-items: stretch`. In bottom-dock mode the explicit `width: 100%` is what
  keeps the cards full width — do not "clean it up".
- **Serial gateways dislike parallel sessions.** `ModbusClient` holds a
  `threading.Lock` and opens a fresh connection per transaction. Keep the lock.
- **RTU frames carry no length field** — `_recv_frame` reads until the line goes
  quiet or the CRC checks out. A 2.5 s timeout is the minimum at 9600 baud.

## Local model for the verdict comment

Benchmarked on the real fact list (2026-09-02, same prompt, warm model):

| Model | Time | Notes |
|---|---|---|
| `qwen2.5:14b-instruct-q4_K_M` | **2.7 s** | best Polish, respects the 4-sentence limit, no invented facts — **in use** |
| `qwen2.5:3b-instruct-q5_K_M` | 0.9 s | fastest, but stilted phrasing |
| `mistral-nemo:12b` | 8.9 s | ignored the length limit, ran into the token cap mid-word, garbled one fact |
| `gemma4-12b-uncensored` | 12.0 s | returned an **empty** response; a trivial one-sentence prompt then failed to finish within 2 min |
| `gemma4:12b` | — | request timed out |

The verdict itself never depends on this — it is computed from the trace facts by
rules. The model only rewrites them, and any failure degrades to a note.

## Testing without touching the hardware

Function `0x08/0x00` (loopback) and `0x08/0x0C` (CRC error counter) are answered by
the Modbus interface itself — they never reach the field bus or the appliances.
`/api/diag` and `/api/trace` rely on this.
