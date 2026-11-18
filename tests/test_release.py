from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.server import create_app, connect
from manage import copy_database

H = {"X-Interval-Action": "1"}
CREDS = dict(role="Customer", email="resident@example.test", password="Private-test-29")


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = create_app(self.root, production=True)
        self.client = self.app.test_client()

    def send(self, path, data):
        return self.client.post(path, base_url="https://localhost", json=data, headers=H)

    def test_https_session_and_logout_revocation(self):
        result = self.send("/api/register", dict(name="Resident", **CREDS))
        self.assertEqual(result.status_code, 201)
        cookie = result.headers["Set-Cookie"]
        self.assertIn("Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        original = self.client.get_cookie("session").value
        self.assertEqual(self.send("/api/logout", {}).status_code, 200)
        self.client.set_cookie("session", original)
        self.assertIsNone(self.client.get("/api/state",base_url="https://localhost").json["user"])

    def test_bad_login_throttled(self):
        for _ in range(12):
            self.assertEqual(self.send("/api/login", CREDS).status_code, 401)
        self.assertEqual(self.send("/api/login", CREDS).status_code, 429)

    def test_template_assets_and_health(self):
        page = self.client.get("/")
        self.assertIn(b'src="/app.js"', page.data)
        self.assertIn("Content-Security-Policy", page.headers)
        self.assertEqual(self.client.get("/healthz").json, {"status":"ok"})
        self.assertEqual(self.client.get("/__check").status_code, 404)

    def test_backup_restore_and_no_overwrite(self):
        self.send("/api/register",dict(name="Resident",**CREDS))
        backup=self.root/"backup.sqlite3"
        recovered=self.root/"copy"/"interval.sqlite3"
        copy_database(self.root/"interval.sqlite3",backup)
        copy_database(backup,recovered,True)
        with self.assertRaises(FileExistsError):
            copy_database(backup,recovered,True)
        with closing(connect(recovered)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM sessions").fetchone()[0],0)
        app=create_app(recovered.parent).test_client()
        self.assertEqual(app.post("/api/login",json=CREDS,headers=H).status_code,200)
        self.assertEqual(app.get("/api/state").json["user"]["name"],"Resident")

    def test_foreign_key_violation_blocks_backup_and_restore(self):
        source = self.root / "interval.sqlite3"
        with closing(connect(source)) as db:
            db.execute("PRAGMA foreign_keys=OFF")
            db.execute("INSERT INTO slots(service_id,start,finish) VALUES(777,1,2)")
        for restoring in (True, False):
            target = self.root / "snapshot.sqlite3"
            with self.assertRaisesRegex(ValueError, "Broken database references"):
                copy_database(source, target, restoring)
            self.assertFalse(target.exists())

    def test_normal_traffic_prunes_only_expired_limits(self):
        import time
        with closing(connect(self.app.config["DATABASE"])) as db:
            db.executemany("INSERT INTO auth_limits VALUES(?,1,?)",
                           [("old", 1), ("valid", int(time.time()) + 600)])
            self.assertEqual(self.client.get("/").status_code, 200)
            self.assertEqual([r[0] for r in db.execute("SELECT bucket FROM auth_limits")], ["valid"])

    def test_first_service_has_its_own_description(self):
        body = dict(CREDS, role="Provider", name="Tutor", category="Education",
                    bio="Ten years of teaching", service="CS tutoring")
        for i, extra in enumerate([{"serviceDescription": "Review a coding exercise"}, {}]):
            data = dict(body, email=f"tutor{i}@example.test", **extra)
            self.assertEqual(self.send("/api/register", data).status_code, 201)
            with closing(connect(self.app.config["DATABASE"])) as db:
                row = db.execute("SELECT bio, description FROM users JOIN services ON users.id=provider_id WHERE email=?",
                                 (data["email"],)).fetchone()
                self.assertEqual(tuple(row), (body["bio"], extra.get("serviceDescription", body["service"])))
            self.send("/api/logout", {})

    def test_wrong_workspace_login(self):
        self.send("/api/register", dict(CREDS, name="Resident"))
        self.send("/api/logout", {})
        wrong = self.send("/api/login", dict(CREDS, role="Provider"))
        self.assertEqual(wrong.status_code, 401)
        self.assertIn("workspace", wrong.json["error"])
        self.assertIsNone(self.client.get("/api/state").json["user"])
        self.assertEqual(self.send("/api/login", CREDS).status_code, 200)
