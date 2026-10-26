# QRDrop

QRDrop supports two transfer methods: QR optical transfer for devices with no network connection, and Local Network transfer through a temporary Python server for fast file sharing over the same Wi-Fi or phone hotspot without internet.

**No cloud storage. No automatic copies. The recipient chooses whether to save a received file.**

## Try QRDrop

Open the hosted app: https://lalitkumar790.github.io/QRDrop/

1. Open QRDrop on both devices while online at least once so the app files can be cached.
2. Disconnect Wi-Fi and mobile data on both devices if you want a strictly offline session.
3. On the sender, choose a file and start the QR stream.
4. On the receiver, open Receive, allow camera access, and scan the sender’s screen.
5. Once the file is reconstructed and verified, choose **Save file** to save it.

## Local Network transfer (no internet required)

Uploads support files up to 50 GiB by default and are sent in 8 MiB chunks with acknowledged offsets, retry handling, per-chunk SHA-256 verification, and a final whole-file SHA-256 digest. The limit is configurable; the server checks available disk space and keeps a 256 MiB free-space reserve by default. If the connection drops or the page reloads, select the same file again in the same tab to resume while the server session remains active (up to six hours). The server only lists a file after all declared bytes arrive and finalization succeeds.

1. Connect both devices to the same Wi-Fi network or to a phone hotspot. Internet access is not required; the devices just need local connectivity. Some managed or guest Wi-Fi networks block device-to-device traffic.
2. On the hosting device, install Python 3 and run `python server.py --host 0.0.0.0 --port 8765 --max-file-size-gib 50 --chunk-size-mib 8`.
3. Open the pairing URL printed by the server on the host, then share that URL only with the intended receiving device.
4. Select **Local Network** in QRDrop to upload, download, refresh, or delete files. Uploaded files are stored in the server's `received/` folder until deleted. Increase `--max-file-size-gib` if you need a larger per-file limit, and ensure the disk has enough free space.
5. Stop the server with Ctrl+C when finished. If another device cannot connect, check the host firewall and ensure Wi-Fi client isolation is disabled. Both devices must be on the same reachable subnet; guest Wi-Fi and some phone hotspots may isolate clients. The server prints its chosen LAN address; if the machine has multiple network adapters or a VPN, verify that address is reachable from the other device.

This local-server mode is available when the UI is served by `server.py`; the public GitHub Pages site cannot itself host a server on your device. The session token protects API operations, but the local HTTP connection is not encrypted. Use trusted networks only and stop the server after the transfer.

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
- `server.py`, `tests/test_server.py` — local-network server and regression tests
