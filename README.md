# QRDrop

**Privacy-first, optical file transfer using animated QR codes.**

QRDrop transfers a file from one screen to another using a looping sequence of QR frames. The sender reads the chosen file in browser memory, the receiver scans frames with a camera, reconstructs the bytes in memory, verifies SHA-256, and offers an explicit save action.

## Deploy on GitHub Pages

1. In this repository, open **Settings → Pages**.
2. Set the build source to **GitHub Actions**.
3. The workflow publishes only the `static/` folder when a commit lands on `main`.
4. Once the workflow succeeds, open: https://lalitkumar790.github.io/QRDrop/

## Offline and privacy architecture

- The optical transfer path is screen → visible QR frames → camera → reconstructed file. It does not use internet, Wi-Fi, WebRTC, LAN sockets, a relay, or a file-upload endpoint.
- All runtime assets, including the QR generator, are hosted in `static/`; the page has **no third-party CDN dependency**.
- Opening the hosted page for the first time still requires downloading it from GitHub Pages. After it has loaded and the service worker has cached its assets, the app can be used with the network disabled. Test offline behavior on the actual devices before relying on it.
- File contents are not encrypted. Anyone who can record/scan the full QR sequence could reconstruct the file; transfer only in a physically private place.
- Sender and receiver data stays in browser memory during the transfer. The receiver must press **Save file** to write a copy to the device. Closing/reloading the page before saving loses the in-memory reconstruction.

## Browser requirements and limitations

- The receiver needs camera permission, a secure context (GitHub Pages provides HTTPS), `getUserMedia`, and `BarcodeDetector` QR support. Support differs across browser versions; recent Android Chrome is the primary target.
- Keep screens bright, devices steady, and the sender running long enough for missing frames to repeat.
- Optical transfer is slow by design: at 512 bytes per frame and a 700 ms frame delay, a 1 MiB file needs about 2,048 frames—roughly 24 minutes for one full cycle, before scanning overhead.
- This is a prototype and has not been validated across physical devices or undergone a production security review.

## Project layout

- `static/index.html`, `static/style.css`, `static/app.js` — user interface and optical transfer logic
- `static/qrcode.min.js`, `static/QRCODE-LICENSE.txt` — locally vendored QR generator and its MIT license
- `static/sw.js`, `static/manifest.webmanifest` — offline cache and installable web-app metadata
- `server.py`, `tests/test_server.py` — legacy local HTTP MVP and regression tests; these are not used by the GitHub Pages optical frontend
