import hashlib, json, os, re, socket, subprocess, sys, tempfile, time, unittest, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

class QRDropHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        s = socket.socket(); s.bind(("127.0.0.1",0)); cls.port=s.getsockname()[1]; s.close()
        cls.proc = subprocess.Popen([sys.executable, str(ROOT/"server.py"), "--host", "127.0.0.1", "--port", str(cls.port), "--data-dir", cls.tmp.name],
                                    cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        cls.base=f"http://127.0.0.1:{cls.port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(cls.base+"/api/health", timeout=.5); break
            except Exception: time.sleep(.15)
        else:
            cls.proc.terminate(); raise RuntimeError("QRDrop test server did not start")
        out=cls.proc.stdout.readline()
        cls.proc.stdout.readline()
        cls.url_line=cls.proc.stdout.readline().strip()
        m=re.search(r"token=([^&\s]+)", cls.url_line)
        if not m: # parse printed pairing link line in the current server output
            for _ in range(5):
                line=cls.proc.stdout.readline()
                m=re.search(r"token=([^&\s]+)", line)
                if m: break
        if not m: raise RuntimeError("Could not read session token from test server")
        cls.token=m.group(1)
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try: cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired: cls.proc.kill()
        cls.tmp.cleanup()
    def request(self,path,method="GET",data=None,headers=None):
        req=urllib.request.Request(self.base+path, data=data, method=method, headers=headers or {})
        return urllib.request.urlopen(req, timeout=5)
    def test_health_is_public(self):
        with self.request("/api/health") as r:
            self.assertEqual(json.load(r)["ok"], True)
    def test_api_requires_token(self):
        with self.assertRaises(urllib.error.HTTPError) as e: self.request("/api/files")
        self.assertEqual(e.exception.code,401)
    def test_api_accepts_token_header(self):
        with self.request("/api/files", headers={"X-QRDrop-Token": self.token}) as r:
            self.assertIn("files", json.load(r))
    def test_upload_list_download_delete_and_hash(self):
        payload=bytes(range(256))*13 + b"\\x00\\xffQRDrop"
        path="/api/upload?token="+self.token+"&name=test%20binary.bin"
        with self.request(path,"POST",payload,{"Content-Type":"application/octet-stream"}) as r:
            result=json.load(r)
        self.assertEqual(result["size"],len(payload))
        self.assertEqual(result["sha256"],hashlib.sha256(payload).hexdigest())
        with self.request("/api/files?token="+self.token) as r: listing=json.load(r)["files"]
        item=next(x for x in listing if x["name"]=="test binary.bin")
        self.assertEqual(item["sha256"],hashlib.sha256(payload).hexdigest())
        with self.request(item["url"]) as r: self.assertEqual(r.read(),payload)
        # Download tickets are single-use and do not expose the reusable session token.
        self.assertIn("ticket=", item["url"])
        self.assertNotIn(self.token, item["url"])
        with self.assertRaises(urllib.error.HTTPError) as expired:
            self.request(item["url"])
        self.assertEqual(expired.exception.code, 401)
        with self.request("/api/files?token="+self.token+"&name=test%20binary.bin","DELETE") as r:
            self.assertTrue(json.load(r)["ok"])
        with self.request("/api/files?token="+self.token) as r:
            self.assertFalse(any(x["name"]=="test binary.bin" for x in json.load(r)["files"]))
    def test_resumable_chunk_upload_and_hash(self):
        payload = bytes(range(256)) * 20500
        start = "/api/upload/start?token=" + self.token + "&name=resumable.bin&size=" + str(len(payload))
        with self.request(start, "POST") as response: session = json.load(response)
        upload_id = session["id"]
        finish = "/api/upload/finish?id=" + upload_id + "&token=" + self.token
        with self.assertRaises(urllib.error.HTTPError) as incomplete: self.request(finish, "POST")
        self.assertEqual(incomplete.exception.code, 409)
        offset = 0
        while offset < len(payload):
            chunk = payload[offset:offset + 4 * 1024 * 1024]
            path = "/api/upload/chunk?id=" + upload_id + "&offset=" + str(offset) + "&token=" + self.token
            with self.request(path, "POST", chunk, {"X-QRDrop-Hash": hashlib.sha256(chunk).hexdigest()}) as response: result = json.load(response)
            offset = result["offset"]
        with self.request(finish, "POST") as response: result = json.load(response)
        self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())

    def test_resumable_chunk_rejects_wrong_offset(self):
        start = "/api/upload/start?token=" + self.token + "&name=offset.bin&size=10"
        with self.request(start, "POST") as response: session = json.load(response)
        path = "/api/upload/chunk?id=" + session["id"] + "&offset=1&token=" + self.token
        with self.assertRaises(urllib.error.HTTPError) as mismatch: self.request(path, "POST", b"abc")
        self.assertEqual(mismatch.exception.code, 409)
        self.assertEqual(json.loads(mismatch.exception.read())["offset"], 0)
    def test_resumable_chunk_rejects_corrupted_payload(self):
        start = "/api/upload/start?token=" + self.token + "&name=integrity.bin&size=3"
        with self.request(start, "POST") as response: session = json.load(response)
        path = "/api/upload/chunk?id=" + session["id"] + "&offset=0&token=" + self.token
        headers = {"X-QRDrop-Hash": hashlib.sha256(b"abc").hexdigest()}
        with self.assertRaises(urllib.error.HTTPError) as mismatch:
            self.request(path, "POST", b"xyz", headers)
        self.assertEqual(mismatch.exception.code, 422)
        self.assertEqual(json.loads(mismatch.exception.read())["offset"], 0)
        good_headers = {"X-QRDrop-Hash": hashlib.sha256(b"abc").hexdigest()}
        with self.request(path, "POST", b"abc", good_headers) as response:
            self.assertEqual(json.load(response)["offset"], 3)
        finish = "/api/upload/finish?id=" + session["id"] + "&token=" + self.token
        with self.request(finish, "POST") as response:
            self.assertEqual(json.load(response)["sha256"], hashlib.sha256(b"abc").hexdigest())

    def test_duplicate_filename_does_not_overwrite(self):
        for data in (b"first",b"second"):
            with self.request("/api/upload?token="+self.token+"&name=same.txt","POST",data) as r: json.load(r)
        with self.request("/api/files?token="+self.token) as r: names={x["name"] for x in json.load(r)["files"]}
        self.assertIn("same.txt",names); self.assertIn("same (1).txt",names)
    def test_qr_endpoint_returns_png(self):
        with self.request("/api/qr.png?token="+self.token) as r:
            self.assertEqual(r.headers.get_content_type(),"image/png")
            self.assertTrue(r.read(8).startswith(b"\x89PNG"))
    def test_security_headers(self):
        with self.request("/") as r:
            self.assertEqual(r.headers.get("Referrer-Policy"), "no-referrer")
            self.assertEqual(r.headers.get("X-Frame-Options"), "DENY")
    def test_ui_and_assets(self):
        with self.request("/") as r: self.assertIn(b"QRDrop",r.read())
        with self.request("/app.js") as r: self.assertIn(b"QDROP1",r.read())
if __name__=="__main__": unittest.main(verbosity=2)
