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
- Local-network uploads are sent in chunks of up to 4 MiB.
- The server acknowledges offsets; retries check server state before resending to avoid appending duplicate bytes after a lost response.
- Partial chunk writes are truncated back to the last acknowledged offset.
- Finalization checks the declared byte count and computes SHA-256 before publishing the completed file.
- Session metadata is held in memory and expires after six hours; reselecting the same file in the same tab can resume while the server process and session remain available.
- Regression tests cover multi-chunk integrity, incorrect offsets, and incomplete finalization. Browser and real network-interruption testing remains outstanding.
