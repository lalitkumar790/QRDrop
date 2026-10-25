# QRDrop

QRDrop moves files between devices using a looping stream of QR codes. The sender displays the frames; the receiver scans them, rebuilds the file in browser memory, verifies its SHA-256 digest, and gives the recipient the choice to save it.

**No cloud storage. No automatic copies. The recipient chooses whether to save a received file.**

## Try QRDrop

Open the hosted app: https://lalitkumar790.github.io/QRDrop/

1. Open QRDrop on both devices while online at least once so the app files can be cached.
2. Disconnect Wi-Fi and mobile data on both devices if you want a strictly offline session.
3. On the sender, choose a file and start the QR stream.
4. On the receiver, open Receive, allow camera access, and scan the sender’s screen.
5. Once the file is reconstructed and verified, choose **Save file** to save it.

## Privacy

- **No cloud storage:** the Pages site serves the app, but no file contents are uploaded to GitHub or any QRDrop server by the optical transfer UI.
- **No automatic copies:** the receiver holds the reconstructed file in tab memory until the user chooses Save file. Closing/reloading the tab before saving clears the unsaved file.
- **Optical transfer only:** file data is carried by QR frames from one screen to another. There is no WebRTC, LAN socket transfer, network relay, or cloud upload in the optical path.
- **No third-party runtime dependency:** the QR generator is hosted in `static/` alongside the app.
- **Unencrypted QR frames:** anyone who can capture the complete QR sequence could reconstruct the file. Do not transfer sensitive material where the sender screen or QR stream can be observed.

## Offline and browser limitations

- The first website load needs internet to download the app. After the service worker caches its files, the app can be used offline; test this on your actual devices before relying on it.
- Receiving requires HTTPS (GitHub Pages supplies it), camera permission, `getUserMedia`, and `BarcodeDetector` support. Browser support varies; recent Android Chrome is the primary target.
- Keep the sender stream running until all frames have been collected. Fast-transfer defaults use about 1,200 bytes of file data per frame and a 250 ms frame interval. This substantially reduces frame count and display time; actual speed depends on camera focus, screen brightness, browser performance, and missed frames. If the receiver misses frames, increase the frame interval in the sender controls.
- The received file lives in browser memory until explicitly saved. After saving, the browser/operating system handles the download location.
- QRDrop is a prototype and has not been tested across every device/browser combination or undergone a production security review.

## Project layout

- `static/index.html`, `static/style.css`, `static/app.js` — UI and optical transfer logic
- `static/qrcode.min.js`, `static/QRCODE-LICENSE.txt` — locally hosted QR generator and MIT license
- `static/sw.js`, `static/manifest.webmanifest` — offline cache and web app metadata
- `server.py`, `tests/test_server.py` — legacy local HTTP MVP and regression tests; not used by the GitHub Pages optical frontend
