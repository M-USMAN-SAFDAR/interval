import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import test_workflow


class SrsAcceptance(unittest.TestCase):
    def test_saved_records_and_decisions(self):
        flow = test_workflow.Workflow()
        self.addCleanup(flow.doCleanups)
        flow.setUp()
        service, slot = flow.prepare_booking()
        send = flow.send
        send(flow.provider, "profile", dict(name="Tutor", category="Education", bio="Math tutor"))
        listing = dict(name="Algebra", description="Practice lesson", category="Education", minutes=45)
        send(flow.provider, "services", listing)
        database = sqlite3.connect(flow.path / "interval.sqlite3")
        self.addCleanup(database.close)
        second = database.execute("SELECT id FROM services WHERE name='Algebra'").fetchone()[0]
        start, finish = database.execute("SELECT start,finish FROM slots WHERE id=?", (slot,)).fetchone()
        def stamp(seconds):
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat()
        path = f"services/{second}/slots"
        send(flow.provider, path, dict(start=stamp(start), end=stamp(finish)), 409)
        send(flow.provider, path, dict(start=stamp(finish), end=stamp(start)), 400)
        future = datetime.now(timezone.utc) + timedelta(days=3)
        times = dict(start=future.isoformat(), end=(future + timedelta(hours=1)).isoformat())
        send(flow.provider, path, times)
        extra = database.execute("SELECT id FROM slots WHERE service_id=?", (second,)).fetchone()[0]
        send(flow.provider, f"{path}/{extra}", {**times, "end":(future + timedelta(hours=2)).isoformat()})
        send(flow.provider, f"{path}/{extra}", dict(remove=True))
        send(flow.provider, f"services/{second}", dict(active=False))
        send(flow.admin, f"services/{second}", {**listing, "name":"Revised lesson"})
        send(flow.admin, f"services/{second}", dict(remove=True))
        def book():
            send(flow.customer, "bookings", dict(slot=slot, reason="Exam preparation"), 201)
            return database.execute("SELECT max(id) FROM bookings").fetchone()[0]
        rejected = book()
        send(flow.provider, f"bookings/{rejected}", dict(status="Rejected"))
        cancelled = book()
        send(flow.provider, f"bookings/{cancelled}", dict(status="Confirmed"))
        send(flow.provider, f"bookings/{cancelled}", dict(status="Cancelled"))
        completed = book()
        send(flow.provider, f"bookings/{completed}", dict(status="Confirmed"))
        send(flow.provider, f"bookings/{completed}", dict(status="Completed"), 409)
        send(flow.customer, f"bookings/{completed}/problems", dict(message="Check appointment"))
        problem = database.execute("SELECT id FROM problems WHERE resolved=0").fetchone()[0]
        send(flow.admin, f"problems/{problem}/resolve", {})
        with patch("backend.server.time.time", return_value=finish+1):
            send(flow.provider, "login", dict(role="Provider", email="p@example.test", password=test_workflow.PASSWORD))
            send(flow.provider, f"bookings/{completed}", dict(status="Completed"))
        self.assertEqual(database.execute("SELECT status FROM bookings ORDER BY id").fetchall(),
                         [("Rejected",), ("Cancelled",), ("Completed",)])
        self.assertEqual(database.execute("SELECT bio FROM users WHERE name='Tutor'").fetchone(), ("Math tutor",))
        self.assertEqual(database.execute("SELECT resolved FROM problems WHERE id=?", (problem,)).fetchone(), (1,))
        self.assertEqual(database.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(database.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_listing_visibility_and_ownership(self):
        flow = test_workflow.Workflow()
        self.addCleanup(flow.doCleanups)
        flow.setUp()
        service, slot = flow.prepare_booking()
        send = flow.send
        guest = flow.app.test_client()
        def visible():
            return service in [listing['id'] for listing in flow.state(guest)['services']]
        listing = f"services/{service}"
        provider_id = flow.state(flow.provider)["user"]["id"]
        send(guest, "bookings", {"slot":slot}, 401)
        send(flow.customer, listing, {"remove":True}, 403)
        self.assertTrue(visible())
        for client, endpoint, hide, show in (
            (flow.provider, listing, {"active":False}, {"active":True}),
            (flow.admin, listing, {"approved":False}, {"approved":True}),
            (flow.admin, f"users/{provider_id}", {"status":"rejected"}, {"status":"approved"}),
            (flow.admin, f"users/{provider_id}", {"active":False}, {"active":True}),
        ):
            send(client, endpoint, hide)
            self.assertFalse(visible())
            send(flow.customer, "bookings", {"slot":slot}, 404)
            send(client, endpoint, show)
            self.assertTrue(visible())
        foreign_provider = flow.app.test_client()
        flow.register(foreign_provider, "Provider", "another@example.test",
                      bio="Second tutor", category="Education", service="Workshop")
        send(foreign_provider, listing, {"remove":True}, 403)
        send(foreign_provider, listing + f"/slots/{slot}", {"remove":True}, 403)
        send(flow.customer, "bookings", {"slot":slot}, 201)
        bid = flow.state(flow.customer)["bookings"][0]["id"]
        send(foreign_provider, f"bookings/{bid}", {"status":"Confirmed"}, 403)
        send(flow.other, f"bookings/{bid}/problems", {"message":"Private"}, 404)
        send(flow.customer, f"bookings/{bid}", {"status":"Cancelled"})
        send(flow.provider, "login", dict(role="Provider", email="p@example.test", password=test_workflow.PASSWORD))
        send(flow.provider, f"bookings/{bid}", {"status":"Confirmed"}, 409)
