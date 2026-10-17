"""Tests for the Privi OS shell service. Run: python3 -m unittest discover os/tests"""
import json, os, socket, subprocess, sys, tempfile, time, unittest, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(HERE), "server.py")

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = tempfile.mkdtemp()
        os.makedirs(os.path.join(cls.home, "Documents"))
        open(os.path.join(cls.home, "Documents", "plan.txt"), "w").write("hi")
        open(os.path.join(cls.home, ".secret"), "w").write("x")
        os.symlink("/etc", os.path.join(cls.home, ".escape-link"))
        os.symlink("/etc", os.path.join(cls.home, "escape"))
        cls.port = free_port()
        env = dict(os.environ, PRIVI_SHELL_PORT=str(cls.port), PRIVI_FILES_ROOT=cls.home,
                   PRIVI_SHELL_DEV="1", PRIVI_NODE_RPC="http://127.0.0.1:9")
        cls.proc = subprocess.Popen([sys.executable, SERVER], env=env, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try: urllib.request.urlopen(cls.url("/api/system"), timeout=1); break
            except Exception: time.sleep(0.1)

    @classmethod
    def tearDownClass(cls): cls.proc.terminate(); cls.proc.wait()

    @classmethod
    def url(cls, p): return f"http://127.0.0.1:{cls.port}{p}"

    def get(self, p):
        try:
            with urllib.request.urlopen(self.url(p), timeout=5) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)

    def post(self, p, body, headers):
        req = urllib.request.Request(self.url(p), data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)

    def test_shell_page(self):
        with urllib.request.urlopen(self.url("/"), timeout=5) as r:
            self.assertIn(b"Privi OS", r.read())

    def test_system(self):
        code, s = self.get("/api/system")
        self.assertEqual(code, 200); self.assertIn("network", s); self.assertIn("version", s)

    def test_node_offline(self):
        code, n = self.get("/api/node")
        self.assertEqual(code, 200); self.assertFalse(n["running"])

    def test_files_lists_home_hides_dotfiles(self):
        code, d = self.get("/api/files?path=")
        self.assertEqual([e["name"] for e in d["entries"]], ["Documents", "escape"])
        code, d = self.get("/api/files?path=Documents")
        self.assertEqual(d["path"], "Documents"); self.assertEqual(d["entries"][0]["name"], "plan.txt")

    def test_files_cannot_escape_home(self):
        for p in ("../", "Documents/../../", "escape"):
            self.assertEqual(self.get("/api/files?path=" + p)[0], 403, p)
        # An absolute path is read relative to home, never the real /etc.
        self.assertEqual(self.get("/api/files?path=/etc")[0], 404)

    def test_power_requires_shell_header(self):
        ok = {"Content-Type": "application/json", "X-Privi-Shell": "1"}
        self.assertEqual(self.post("/api/power", {"action": "reboot"}, {"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.post("/api/power", {"action": "reboot"}, {"Content-Type": "text/plain", "X-Privi-Shell": "1"})[0], 403)
        self.assertEqual(self.post("/api/power", {"action": "reboot"}, dict(ok, Origin="https://evil.example"))[0], 403)
        self.assertEqual(self.post("/api/power", {"action": "rm -rf"}, ok)[0], 400)
        code, r = self.post("/api/power", {"action": "reboot"}, dict(ok, Origin=f"http://127.0.0.1:{self.port}"))
        self.assertEqual(code, 200); self.assertTrue(r.get("dev"))

if __name__ == "__main__":
    unittest.main()
