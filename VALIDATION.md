# QRDrop validation report

## Automated checks recorded locally
- Python syntax compilation: PASS.
- Legacy local-server HTTP regression suite: 8 PASS.
- JavaScript syntax check with Node.js: PASS.
- GitHub Pages workflow and static optical frontend files prepared.

## Optical transfer behavior
- Sender reads a selected file in browser memory and divides it into 512-byte chunks.
- Each QR frame contains a transfer ID, sequence number, total frames, encoded filename, SHA-256 digest, and chunk payload.
- Receiver collects out-of-order frames, ignores duplicates, reconstructs a Blob in memory, checks SHA-256, and only then offers an explicit Save action.
- Runtime JavaScript assets, including the QR generator, are served from the same origin. The frontend does not require a third-party CDN.

## Not validated here
- Physical QR scanning between a Windows laptop and a Realme 10.
- Camera compatibility/reliability on particular Android/browser versions.
- Offline service-worker install and reload behavior on every browser.
- Real optical throughput across different screen brightness, camera focus, distance, and file sizes.

## Important limitations
- First load of the GitHub Pages website needs internet to download the app. After local caching, the transfer protocol itself uses no network connection, cloud storage, WebRTC, or relay.
- Receiving requires HTTPS (GitHub Pages provides it), camera permission, and browser support for `BarcodeDetector` and `getUserMedia`.
- At 512 bytes per frame and 700 ms per frame, a 1 MiB file requires about 2,048 frames or 24 minutes for one cycle, before camera-scanning overhead.
- The received file is held in browser memory until explicitly saved or the page is closed/reloaded.
- QR frames are not encrypted; anyone who can capture the complete sequence may reconstruct the file.
