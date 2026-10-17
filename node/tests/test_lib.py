"""Offline tests for privi_node_lib.py. Run: python3 -m unittest discover node/tests"""
import json, os, shutil, subprocess, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import privi_node_lib as lib

GOOD = {
    "name": "Privi Test", "network_status": "public-testnet",
    "cosmos_chain_id": "privi-testnet-1", "evm_chain_id": 7771,
    "upstream_tag": "v0.7.3", "denom": "apriv", "minimum_gas_prices": "0.0001apriv",
    "genesis_url": "https://example.org/genesis.json", "genesis_sha256": "a" * 64,
    "seeds": ["0123456789abcdef0123456789abcdef01234567@seed1.example.org:26656"],
    "persistent_peers": [],
}
CONFIG = """proxy_app = "tcp://127.0.0.1:26658"
[rpc]
laddr = "tcp://127.0.0.1:26657"
[p2p]
laddr = "tcp://0.0.0.0:26656"
seeds = ""
persistent_peers = ""
pex = false
[mempool]
type = "flood"
"""
APP = """minimum-gas-prices = ""
[json-rpc]
enable = false
address = "127.0.0.1:8545"
"""

class Validate(unittest.TestCase):
    def errs(self, **changes):
        m = dict(GOOD); m.update(changes); return lib.validate(m)
    def test_good(self): self.assertEqual(lib.validate(GOOD), [])
    def test_example_template_refused(self):
        m = lib.load_manifest(os.path.join(os.path.dirname(HERE), "network.example.json"))
        self.assertTrue(any("network_status" in e for e in lib.validate(m)))
    def test_planned_refused(self): self.assertTrue(self.errs(network_status="planned"))
    def test_demo_chain_refused(self): self.assertTrue(self.errs(cosmos_chain_id="local-4221"))
    def test_demo_evm_id_refused(self): self.assertTrue(self.errs(evm_chain_id=4221))
    def test_http_genesis_refused(self): self.assertTrue(self.errs(genesis_url="http://x/g.json"))
    def test_bad_hash(self): self.assertTrue(self.errs(genesis_sha256="abc"))
    def test_no_peers(self): self.assertTrue(self.errs(seeds=[]))
    def test_bad_peer(self): self.assertTrue(self.errs(seeds=["nope@host:1"]))
    def test_wrong_tag(self): self.assertTrue(self.errs(upstream_tag="v0.8.0"))
    def test_gas_denom_mismatch(self): self.assertTrue(self.errs(minimum_gas_prices="1atest"))
    def test_injection_quoted(self):
        m = dict(GOOD, name="x'; rm -rf / #")
        out = lib.shell_exports(m)
        r = subprocess.run(["bash", "-c", out + '\nprintf %s "$NET_NAME"'], capture_output=True, text=True)
        self.assertEqual(r.stdout, "x'; rm -rf / #")

class Configure(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(); os.mkdir(os.path.join(self.home, "config"))
        for name, body in (("config.toml", CONFIG), ("app.toml", APP)):
            open(os.path.join(self.home, "config", name), "w").write(body)
        json.dump({"chain_id": "privi-testnet-1"}, open(os.path.join(self.home, "config", "genesis.json"), "w"))
        self.mf = os.path.join(self.home, "m.json"); json.dump(GOOD, open(self.mf, "w"))
    def tearDown(self): shutil.rmtree(self.home)
    def read(self, n): return open(os.path.join(self.home, "config", n)).read()
    def test_configure(self):
        self.assertEqual(lib.main(["x", "configure", self.home, self.mf]), 0)
        c, a = self.read("config.toml"), self.read("app.toml")
        self.assertIn('seeds = "%s"' % GOOD["seeds"][0], c)
        self.assertIn("pex = true", c)
        self.assertIn('type = "app"', c)
        self.assertIn('laddr = "tcp://0.0.0.0:26657"', c)
        self.assertIn('proxy_app = "tcp://127.0.0.1:26658"', c)
        self.assertIn('minimum-gas-prices = "0.0001apriv"', a)
        self.assertIn("enable = true", a)
    def test_wrong_chain_refused(self):
        json.dump({"chain_id": "other-1"}, open(os.path.join(self.home, "config", "genesis.json"), "w"))
        self.assertEqual(lib.main(["x", "configure", self.home, self.mf]), 1)
    def test_refresh_only_touches_peers(self):
        m = dict(GOOD, persistent_peers=["fedcba9876543210fedcba9876543210fedcba98@p.example.org:26656"])
        json.dump(m, open(self.mf, "w"))
        self.assertEqual(lib.main(["x", "refresh-peers", self.home, self.mf]), 0)
        c = self.read("config.toml")
        self.assertIn("p.example.org", c)
        self.assertIn('type = "flood"', c)  # untouched by refresh
        self.assertEqual(self.read("app.toml"), APP)

if __name__ == "__main__":
    unittest.main()
