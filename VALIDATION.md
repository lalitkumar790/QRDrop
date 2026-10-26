# QRDrop validation report

## Earlier automated checks
- Earlier local syntax checks: Python compilation and JavaScript syntax check passed.
- Earlier local-server regression suite: 8 tests passed.
- GitHub Pages deployment workflow passed for the previous version. The current interface update is committed separately.

## Optical transfer behavior
- Sender reads the selected file in browser memory and divides it into 512-byte chunks.
- Each QR frame contains transfer ID, sequence, total frames, encoded filename, SHA-256 digest, and chunk payload.
- Receiver collects out-of-order frames, ignores duplicates, reconstructs a Blob in memory, checks SHA-256, and only then offers an explicit Save action.
- No automatic download or remote copy is made. After the user chooses Save file, the frontend releases its in-memory references to the reconstructed Blob and received chunk map.
- Runtime JavaScript including the QR generator is same-origin and does not require a third-party CDN.

## Interface update
- Replaced the dark neon/gradient styling with a quieter light palette, plain language, modest borders, clearer spacing, responsive layout, and improved focus indicators.
- Added an explicit promise: no cloud storage, no automatic copies, and save only by user choice.
- Kept a clear warning that QR frames are visible and unencrypted.

## Not validated here
- Physical QR scanning between a Windows laptop and a Realme 10.
- Camera behavior across specific Android/browser versions.
- Offline service-worker install and reload on every browser.
- Real throughput at different screen brightness, camera focus, distance, and file sizes.

## Important limitations
- First load of GitHub Pages needs internet to download the app. After local caching, the transfer protocol itself uses no network connection, cloud storage, WebRTC, or relay.
- Receiving requires HTTPS, camera permission, and browser support for `BarcodeDetector` and `getUserMedia`.
- At 512 bytes per frame and 700 ms per frame, a 1 MiB file needs about 2,048 frames or 24 minutes per cycle before camera-scanning overhead.
- The received file is held in browser memory until explicitly saved or the page is closed/reloaded.
- QR frames are not encrypted; anyone who captures the full sequence may reconstruct the file.

## Resumable upload implementation
- Local-network uploads support a configurable per-file limit (50 GiB by default) and use 8 MiB chunks by default; both are configurable at server startup.
- Each chunk carries a SHA-256 digest computed by the browser. A pure-JavaScript SHA-256 fallback supports HTTP pages served from private LAN IPs where Web Crypto is unavailable.
- The server acknowledges offsets; retries check server state before resending to avoid appending duplicate bytes after a lost response.
- Partial chunk writes are truncated back to the last acknowledged offset.
- Finalization checks the declared byte count and computes SHA-256 before publishing the completed file.
- Session metadata is held in memory and expires after six hours; reselecting the same file in the same tab can resume while the server process and session remain available.
- Regression tests cover multi-chunk integrity, corrupted chunks, incorrect offsets, and incomplete finalization. Browser and real network-interruption testing remains outstanding.

## Large-file LAN improvements
- Server startup options: `--max-file-size-gib` (default 50), `--chunk-size-mib` (default 8, allowed 1-32), and `--reserve-free-mib` (default 256).
- The server advertises its configured file/chunk limits and free disk space to the UI.
- Upload starts are rejected if the requested file plus active upload reservations and the free-space safety reserve exceed available disk space.
- Upload chunks use per-session locks so a slow client does not hold the global upload registry lock and block unrelated transfers.
- Download streaming uses larger 4 MiB reads to reduce Python-level write overhead.
- New regression tests assert the 50 GiB default limit and 8 MiB chunk setting, and reject requests above the configured maximum without allocating the requested file size.
- End-to-end large-file throughput and real Wi-Fi/hotspot compatibility still require testing on actual devices and filesystems.
- SHA-256 digests for completed files are cached against file size and nanosecond modification time, avoiding a full multi-gigabyte disk read on every file-list refresh; newly uploaded files seed the cache with their already-computed digest.
