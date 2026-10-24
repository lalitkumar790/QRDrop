# QRDrop

**Privacy-first optical file transfer using animated QR codes.**

QRDrop splits a selected file into QR frames on the sender's screen. A receiver scans those frames with a camera, rebuilds the file in browser memory, validates its SHA-256 checksum, and lets the recipient save it locally.

## Privacy model

- **No file upload or relay:** the optical transfer UI does not send file contents to a server.
- **No cloud storage:** the sender's file is processed in browser memory and represented as QR frames.
- **No WebRTC, LAN transfer, or network relay:** the intended data path is screen-to-camera.
- **Checksum verification:** the receiver verifies the reconstructed bytes with SHA-256 before offering the file for saving.
- QR data is **not encrypted**. Anyone who can capture all frames may reconstruct the transferred file. Do not transfer sensitive files in a public or observable setting unless you add end-to-end encryption.

## GitHub Pages

The repository includes a GitHub Actions workflow that publishes the `static/` directory to GitHub Pages whenever changes are pushed to `main`.

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open **Actions** and confirm the **Deploy QRDrop to GitHub Pages** workflow completes.
4. The published URL should be `https://lalitkumar790.github.io/QRDrop/`.

## Browser and offline limitations

- Camera receiving requires a secure context (HTTPS on GitHub Pages), camera permission, and a browser that supports `getUserMedia` and `BarcodeDetector`. Support varies by browser and version.
- The QR generator library is loaded from a CDN on initial load and may be cached by the service worker. **The first visit requires internet access**; offline startup is not guaranteed until all required resources have been cached successfully.
- After the app and dependencies have been cached, the optical transfer itself can be performed with internet and Wi-Fi disabled.
- Transfer is intentionally slow compared with network transfer. At a 512-byte payload per frame, 1 MiB requires roughly 2,048 frames; at 700 ms per frame, one uninterrupted cycle is about 24 minutes, excluding scanning overhead. The receiver gathers frames continuously, so keep the sender running until all frames have been collected.
- Files are held in browser memory during a session. The receiver must explicitly save the completed file; closing/reloading the page can lose an unsaved transfer.
- Camera focus, display brightness, screen refresh, distance, and ambient light affect reliability.

## Project layout

- `static/index.html` — static web interface
- `static/style.css` — UI styling
- `static/app.js` — QR frame encoding, scanning, reassembly, and checksum verification
- `static/sw.js` — same-origin static asset caching
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow

The legacy Python server and its tests, if present in the repository, are not required for the GitHub Pages optical-transfer experience.

## Security note

QRDrop is a browser-based transfer prototype, not a security audit or a guarantee that every browser cache behaves identically. Review the code before transferring sensitive material, and verify that the browser is genuinely offline when that requirement matters.
