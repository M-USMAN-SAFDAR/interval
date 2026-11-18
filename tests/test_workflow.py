import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier

from backend.server import ADMIN_EMAIL, connect, create_app

HEADERS = {"X-Interval-Action": "1"}
PASSWORD = "Example-Password-28"


class Workflow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.app = create_app(self.path)
        self.app.testing = True
        self.admin = self.app.test_client()
        self.customer = self.app.test_client()
        self.provider = self.app.test_client()
        self.other = self.app.test_client()
        db = connect(self.path / "interval.sqlite3")
        db.close()

    def send(self, client, endpoint, payload, expected=200):
        response = client.post("/api/"+endpoint, json=payload, headers=HEADERS)
        self.assertEqual(response.status_code, expected, response.json)
        return response.json

    def register(self, client, role, email, **fields):
        self.send(client, "register", dict(name=role, role=role, email=email, password=PASSWORD, **fields), 201)
        return self.state(client)["user"]["id"]

    def state(self, client):
        return client.get("/api/state").json

    def prepare_booking(self):
        self.register(self.admin,"Administrator",ADMIN_EMAIL)
        pid=self.register(self.provider,"Provider","p@example.test",bio="Python tutor",category="Education",service="Lesson")
        self.register(self.customer,"Customer","c@example.test")
        self.register(self.other,"Customer","d@example.test")
        self.assertEqual(self.state(self.customer)["services"],[])
        self.send(self.admin,f"users/{pid}",{"status":"approved"})
        sid=self.state(self.provider)["services"][0]["id"]
        start=datetime.now(timezone.utc)+timedelta(days=1)
        times={"start":start.isoformat(),"end":(start+timedelta(minutes=45)).isoformat()}
        self.send(self.provider,f"services/{sid}/slots",times)
        self.send(self.provider,f"services/{sid}/slots",times,409)
        tid=self.state(self.customer)["services"][0]["slots"][0]["id"]
        return sid,tid

    def test_credentials_and_persistence(self):
        uid=self.register(self.customer,"Customer","client@example.test")
        self.send(self.customer,"logout",{})
        self.assertIsNone(self.state(self.customer)["user"])
        credentials=dict(email="CLIENT@example.test",password=PASSWORD,role="Customer")
        self.send(self.customer,"login",{**credentials,"password":"wrong"},401)
        self.send(self.customer,"login",{**credentials,"role":"Provider"},401)
        restarted=create_app(self.path).test_client()
        self.send(restarted,"login",credentials)
        self.assertEqual(self.state(restarted)["user"]["id"],uid)
        self.send(restarted,"users/1",{"active":False},403)
        db=connect(self.path/"interval.sqlite3")
        self.assertNotEqual(db.execute("SELECT password_hash FROM users").fetchone()[0],PASSWORD)
        db.close()

    def test_concurrent_booking_visibility_and_history(self):
        sid,tid=self.prepare_booking()
        barrier=Barrier(2)
        def book(client):
            barrier.wait()
            return client.post("/api/bookings",json={"slot":tid},headers=HEADERS).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            codes=list(pool.map(book,(self.customer,self.other)))
        self.assertEqual(sorted(codes),[201,409])
        winner,loser=(self.customer,self.other) if codes[0]==201 else (self.other,self.customer)
        bid=self.state(winner)["bookings"][0]["id"]
        self.assertEqual(self.state(loser)["bookings"],[])
        self.send(loser,f"bookings/{bid}",{"status":"Cancelled"},403)
        self.send(self.provider,f"services/{sid}/slots/{tid}",{"remove":True},409)
        self.send(self.provider,f"bookings/{bid}",{"status":"Confirmed"})
        self.assertEqual(self.state(winner)["bookings"][0]["status"],"Confirmed")
        self.send(winner,f"bookings/{bid}",{"status":"Cancelled"})
        self.send(loser,"bookings",{"slot":tid},201)
        self.send(self.provider,f"services/{sid}",{"remove":True})
        self.assertEqual(self.state(winner)["bookings"][0]["name"],"Lesson")
        self.assertEqual(self.state(winner)["bookings"][0]["status"],"Cancelled")
        new_client=create_app(self.path).test_client()
        self.send(new_client,"login",dict(email="p@example.test",password=PASSWORD,role="Provider"))
        self.assertEqual(len(self.state(new_client)["bookings"]),2)

    def test_admin_activation_and_deactivation(self):
        self.register(self.admin,"Administrator",ADMIN_EMAIL)
        # Second admin registration should fail
        self.send(self.other,"register",dict(role="Administrator",name="Admin2",email=ADMIN_EMAIL,
                  password=PASSWORD),403)
        uid=self.register(self.customer,"Customer","c@example.test")
        self.send(self.admin,f"users/{uid}",{"active":False})
        self.assertIsNone(self.state(self.customer)["user"])
        self.send(self.customer,"login",dict(role="Customer",email="c@example.test",password=PASSWORD),401)
        self.send(self.admin,f"users/{uid}",{"active":True})
        self.assertIsNone(self.state(self.customer)["user"])
        self.send(self.customer,"login",dict(role="Customer",email="c@example.test",password=PASSWORD))
        self.assertEqual(self.customer.post("/api/logout",json={}).status_code,403)

if __name__=="__main__":
    unittest.main()
