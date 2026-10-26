#!/usr/bin/env python3
"""QRDrop: local-network file transfer server. Python standard library + qrcode for pairing QR."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote
from pathlib import Path
import argparse, hashlib, json, mimetypes, os, secrets, socket, sys, threading, time, re, webbrowser, shutil
try:
    import qrcode
except ImportError:
    qrcode = None

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "received"
MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024  # Default 50 GiB per file; configurable at launch.
TOKEN = secrets.token_urlsafe(24)
STARTED = time.time()
lock = threading.Lock()
download_tickets = {}
DOWNLOAD_TICKET_TTL = 10 * 60
upload_sessions = {}
UPLOAD_SESSION_TTL = 6 * 60 * 60
MAX_CHUNK_BYTES = 8 * 1024 * 1024
RESERVE_FREE_BYTES = 256 * 1024 * 1024

def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()

def sha256_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_name(name):
    name = name.replace("\\", "/").split("/")[-1].strip().replace("\x00", "")
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "_", name)
    if name in ("", ".", ".."):
        name = "received-file"
    return name[:240]

def unique_path(name):
    target = DATA_DIR / name
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    n = 1
    while True:
        candidate = DATA_DIR / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
        n += 1

class Handler(BaseHTTPRequestHandler):
    server_version = "QRDrop/1.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Avoid logging query strings, which may contain session credentials.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt.split('"')[0].strip()))

    def send_bytes(self, code, data, ctype="application/octet-stream", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        if headers:
            for k, v in headers.items(): self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def json(self, code, obj):
        self.send_bytes(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def authorized(self):
        parsed = urlparse(self.path)
        token = parse_qs(parsed.query).get("token", [""])[0] or self.headers.get("X-QRDrop-Token", "")
        return secrets.compare_digest(token, TOKEN)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            try: data = (STATIC_DIR / "index.html").read_bytes()
            except OSError: return self.send_bytes(500, b"UI missing", "text/plain")
            return self.send_bytes(200, data, "text/html; charset=utf-8")
        if path == "/app.js":
            return self.send_bytes(200, (STATIC_DIR / "app.js").read_bytes(), "text/javascript; charset=utf-8")
        if path == "/qrcode.min.js":
            return self.send_bytes(200, (STATIC_DIR / "qrcode.min.js").read_bytes(), "text/javascript; charset=utf-8")
        if path == "/style.css":
            return self.send_bytes(200, (STATIC_DIR / "style.css").read_bytes(), "text/css; charset=utf-8")
        if path == "/api/health":
            return self.json(200, {"ok": True, "app": "QRDrop", "version": "1.2.0"})
        if path == "/download":
            ticket = parse_qs(parsed.query).get("ticket", [""])[0]
            with lock:
                entry = download_tickets.pop(ticket, None) if ticket else None
            if not entry or entry["expires"] < time.time():
                return self.json(401, {"error": "Download link expired or already used. Refresh the file list and try again."})
            name = safe_name(entry["name"])
            target = (DATA_DIR / name).resolve()
            if target.parent != DATA_DIR.resolve() or not target.is_file():
                return self.json(404, {"error": "File not found"})
            try:
                size = target.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''"+quote(target.name))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                with target.open("rb") as f:
                    for chunk in iter(lambda: f.read(1024*1024), b""):
                        self.wfile.write(chunk)
            except (OSError, BrokenPipeError):
                pass
            return
        if not self.authorized():
            return self.json(401, {"error": "Invalid or missing session token. Open QRDrop using the pairing link."})
        if path == "/api/upload/status":
            upload_id = parse_qs(parsed.query).get("id", [""])[0]
            with lock:
                session = upload_sessions.get(upload_id)
                if not session or session["expires"] < time.time():
                    if session:
                        upload_sessions.pop(upload_id, None)
                        session["temp"].unlink(missing_ok=True)
                    return self.json(404, {"error": "Upload session expired or not found"})
                return self.json(200, {"id": upload_id, "offset": session["offset"], "size": session["size"]})
        if path == "/api/info":
            host = f"{local_ip()}:{self.server.server_port}"
            return self.json(200, {"name": socket.gethostname(), "host": host, "token": TOKEN, "uptime": int(time.time()-STARTED), "max_file_bytes": MAX_FILE_BYTES, "chunk_size": MAX_CHUNK_BYTES, "free_bytes": shutil.disk_usage(DATA_DIR).free})
        if path == "/api/qr.png":
            if qrcode is None:
                return self.json(503, {"error": "QR generation requires the 'qrcode[pil]' package. Run install.bat or pip install -r requirements.txt."})
            host = f"{local_ip()}:{self.server.server_port}"
            url = f"http://{host}/#token={quote(TOKEN)}"
            import io
            img = qrcode.make(url)
            buf = io.BytesIO(); img.save(buf, format="PNG")
            return self.send_bytes(200, buf.getvalue(), "image/png")
        if path == "/api/files":
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            rows = []
            for p in sorted(DATA_DIR.iterdir(), key=lambda x: x.name.lower()):
                if p.is_file() and not p.name.startswith("."):
                    try:
                        st = p.stat()
                        ticket = secrets.token_urlsafe(24)
                        with lock:
                            now = time.time()
                            for old_ticket in [k for k, v in download_tickets.items() if v["expires"] < now]:
                                download_tickets.pop(old_ticket, None)
                            download_tickets[ticket] = {"name": p.name, "expires": now + DOWNLOAD_TICKET_TTL}
                        rows.append({"name": p.name, "size": st.st_size, "sha256": sha256_file(p),
                                     "modified": int(st.st_mtime), "url": "/download?ticket="+quote(ticket)})
                    except OSError: pass
            return self.json(200, {"files": rows})
        return self.json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path not in ("/api/upload", "/api/upload/start", "/api/upload/chunk", "/api/upload/finish"):
            return self.json(404, {"error": "Not found"})
        if not self.authorized():
            return self.json(401, {"error": "Invalid or missing session token"})

        if path == "/api/upload/start":
            try:
                size = int(parse_qs(parsed.query).get("size", ["-1"])[0])
            except ValueError:
                size = -1
            if size < 0 or size > MAX_FILE_BYTES:
                return self.json(413, {"error": "Invalid file size or file exceeds configured per-file limit"})
            name = safe_name(parse_qs(parsed.query).get("name", [""])[0])
            if not name:
                return self.json(400, {"error": "A filename is required"})
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            # Reserve capacity for active uploads so simultaneous starts do not all
            # assume the same free disk space is available.
            with lock:
                now = time.time()
                for old_id, old in list(upload_sessions.items()):
                    if old["expires"] < now:
                        upload_sessions.pop(old_id, None)
                        old["temp"].unlink(missing_ok=True)
                pending_bytes = sum(max(0, item["size"] - item["offset"]) for item in upload_sessions.values())
                free_bytes = shutil.disk_usage(DATA_DIR).free
                if free_bytes < size + pending_bytes + RESERVE_FREE_BYTES:
                    return self.json(507, {"error": "Not enough free disk space for this upload plus the safety reserve", "free_bytes": free_bytes, "requested_bytes": size, "reserved_bytes": pending_bytes, "reserve_bytes": RESERVE_FREE_BYTES})
            upload_id = secrets.token_urlsafe(18)
            temp = DATA_DIR / ("." + secrets.token_hex(12) + ".upload")
            try:
                temp.touch(exist_ok=False)
            except OSError:
                return self.json(500, {"error": "Could not create temporary upload"})
            with lock:
                upload_sessions[upload_id] = {"name": name, "size": size, "offset": 0, "temp": temp, "expires": time.time() + UPLOAD_SESSION_TTL, "session_lock": threading.Lock()}
            return self.json(201, {"id": upload_id, "offset": 0, "size": size, "chunk_size": MAX_CHUNK_BYTES})

        if path == "/api/upload/chunk":
            upload_id = parse_qs(parsed.query).get("id", [""])[0]
            try:
                offset = int(parse_qs(parsed.query).get("offset", ["-1"])[0])
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                offset, length = -1, -1
            if length < 0 or length > MAX_CHUNK_BYTES:
                return self.json(413, {"error": "Chunk must be at most " + str(MAX_CHUNK_BYTES // (1024 * 1024)) + " MiB"})
            # Look up quickly under the registry lock, then serialize only requests
            # for this upload. Other clients can continue uploading concurrently.
            with lock:
                session = upload_sessions.get(upload_id)
            if not session:
                return self.json(404, {"error": "Upload session expired or not found"})
            with session["session_lock"]:
                if session["expires"] < time.time():
                    return self.json(404, {"error": "Upload session expired or not found"})
                if offset != session["offset"]:
                    return self.json(409, {"error": "Chunk offset mismatch", "offset": session["offset"]})
                if offset + length > session["size"]:
                    return self.json(413, {"error": "Chunk exceeds declared file size"})
                expected_hash = self.headers.get("X-QRDrop-Hash", "").lower()
                if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
                    return self.json(400, {"error": "A valid X-QRDrop-Hash header is required"})
                try:
                    payload = self.rfile.read(length) if length else b""
                    if len(payload) != length:
                        raise ConnectionError("Connection ended before the chunk arrived")
                    actual_hash = hashlib.sha256(payload).hexdigest()
                    if not secrets.compare_digest(actual_hash, expected_hash):
                        return self.json(422, {"error": "Chunk integrity check failed", "offset": session["offset"]})
                    with session["temp"].open("r+b") as out:
                        out.truncate(offset)
                        out.seek(offset)
                        out.write(payload)
                        out.flush()
                        os.fsync(out.fileno())
                    session["offset"] += length
                    session["expires"] = time.time() + UPLOAD_SESSION_TTL
                    return self.json(200, {"ok": True, "offset": session["offset"], "size": session["size"]})
                except Exception as exc:
                    try:
                        with session["temp"].open("r+b") as out:
                            out.truncate(session["offset"])
                    except OSError:
                        pass
                    return self.json(400, {"error": "Chunk write failed: " + str(exc)[:120], "offset": session["offset"]})

        if path == "/api/upload/finish":
            upload_id = parse_qs(parsed.query).get("id", [""])[0]
            with lock:
                session = upload_sessions.get(upload_id)
                if not session or session["expires"] < time.time():
                    return self.json(404, {"error": "Upload session expired or not found"})
                if session["offset"] != session["size"]:
                    return self.json(409, {"error": "Upload is incomplete", "offset": session["offset"], "size": session["size"]})
                try:
                    actual_size = session["temp"].stat().st_size
                    if actual_size != session["size"]:
                        return self.json(409, {"error": "Temporary file size mismatch"})
                    digest = sha256_file(session["temp"])
                    target = unique_path(session["name"])
                    os.link(session["temp"], target)
                    session["temp"].unlink()
                    upload_sessions.pop(upload_id, None)
                    return self.json(201, {"ok": True, "name": target.name, "size": actual_size, "sha256": digest})
                except OSError as exc:
                    return self.json(500, {"error": "Could not finalize upload: " + str(exc)[:120]})

        # Backwards-compatible single-request upload endpoint.
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_FILE_BYTES:
            return self.json(413, {"error": "Invalid file size or file exceeds 8 GiB per-file limit"})
        raw_name = parse_qs(parsed.query).get("name", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_FILE_BYTES:
            return self.json(413, {"error": "Invalid file size or file exceeds 8 GiB per-file limit"})
        raw_name = parse_qs(urlparse(self.path).query).get("name", [""])[0]
        name = safe_name(raw_name)
        if not name:
            return self.json(400, {"error": "A filename is required"})
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp = DATA_DIR / ("." + secrets.token_hex(12) + ".part")
        h = hashlib.sha256()
        remaining = length
        try:
            with temp.open("wb") as out:
                while remaining:
                    chunk = self.rfile.read(min(1024*1024, remaining))
                    if not chunk:
                        raise ConnectionError("Connection ended before the entire file arrived")
                    out.write(chunk); h.update(chunk); remaining -= len(chunk)
                out.flush(); os.fsync(out.fileno())
            # Hard-link commit is atomic and refuses to overwrite a file created by a concurrent upload.
            # Temp and destination live in the same directory/filesystem.
            with lock:
                target = unique_path(name)
                os.link(temp, target)
                temp.unlink()
            return self.json(201, {"ok": True, "name": target.name, "size": length, "sha256": h.hexdigest()})
        except Exception as exc:
            try: temp.unlink(missing_ok=True)
            except OSError: pass
            return self.json(400, {"error": "Upload did not complete: " + str(exc)[:180]})

    def do_DELETE(self):
        if urlparse(self.path).path != "/api/files":
            return self.json(404, {"error": "Not found"})
        if not self.authorized():
            return self.json(401, {"error": "Invalid or missing session token"})
        name = safe_name(parse_qs(urlparse(self.path).query).get("name", [""])[0])
        target = (DATA_DIR / name).resolve()
        if target.parent != DATA_DIR.resolve() or not target.is_file():
            return self.json(404, {"error": "File not found"})
        try:
            target.unlink()
            return self.json(200, {"ok": True})
        except OSError as exc:
            return self.json(500, {"error": str(exc)})

def main():
    parser = argparse.ArgumentParser(description="QRDrop local file-transfer server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: all local interfaces)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", default=str(APP_DIR / "received"))
    parser.add_argument("--max-file-size-gib", type=float, default=50.0, help="Maximum individual file size in GiB (default: 50)")
    parser.add_argument("--chunk-size-mib", type=int, default=8, help="Upload chunk size in MiB (default: 8; range 1-32)")
    parser.add_argument("--reserve-free-mib", type=int, default=256, help="Keep this much disk space free when accepting uploads (default: 256)")
    parser.add_argument("--open-browser", action="store_true", help="Open the local session URL in the default browser")
    args = parser.parse_args()
    if args.max_file_size_gib <= 0 or not 1 <= args.chunk_size_mib <= 32 or args.reserve_free_mib < 0:
        parser.error("--max-file-size-gib must be positive, --chunk-size-mib must be 1-32, and --reserve-free-mib must be nonnegative")
    global DATA_DIR, MAX_FILE_BYTES, MAX_CHUNK_BYTES, RESERVE_FREE_BYTES
    MAX_FILE_BYTES = int(args.max_file_size_gib * 1024 ** 3)
    MAX_CHUNK_BYTES = args.chunk_size_mib * 1024 * 1024
    RESERVE_FREE_BYTES = args.reserve_free_mib * 1024 * 1024
    DATA_DIR = Path(args.data_dir).expanduser().resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print("\nQRDrop — Universal Local File Transfer v1.2")
    print("=" * 42)
    print(f"Maximum file size: {MAX_FILE_BYTES / (1024 ** 3):g} GiB")
    print(f"Upload chunk size: {MAX_CHUNK_BYTES // (1024 * 1024)} MiB")
    print(f"Free-space reserve: {RESERVE_FREE_BYTES // (1024 * 1024)} MiB")
    session_url = f"http://{local_ip()}:{args.port}/#token={quote(TOKEN)}"
    print(f"Open on this computer: {session_url}")
    print(f"Pairing link for the other device: {session_url}")
    print("No internet or cloud service is used for file transfer.")
    print("Session token is shown in the local UI/QR. Only share it with the intended device.")
    print("Press Ctrl+C to stop.\n", flush=True)
    if args.open_browser:
        try: webbrowser.open(session_url)
        except Exception: pass
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopping QRDrop...")
    finally: server.server_close()

if __name__ == "__main__":
    main()
