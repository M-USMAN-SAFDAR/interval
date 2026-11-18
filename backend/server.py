from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import hashlib
import re
import secrets
import sqlite3
import time
from threading import Lock

from flask import Flask, abort, g, jsonify, request, session, render_template
from flask_login import LoginManager, UserMixin, current_user, login_user, logout_user
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parents[1]
ADMIN_EMAIL = "admin@interval.demo"
CATEGORIES = {"Education", "Technology", "Consultancy", "Other"}
PUBLIC_USER = "id,name,email,role,active,status,category,bio"


def connect(path):
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def database():
    if "db" not in g:
        g.db = connect(g.database_path)
    return g.db


@contextmanager
def transaction():
    db = database()
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise


class Account(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.role = row["role"]
        self.version = row["version"]

    def get_id(self):
        return f"{self.id}.{self.version}"


def value(body, key, limit, optional=False):
    text = body.get(key, "")
    if not isinstance(text, str) or len(text) > limit or (not optional and not text.strip()):
        abort(400, f"Enter a valid {key} (up to {limit} characters).")
    return text.strip()


def category(body):
    cat = body.get("category")
    if cat not in tuple(CATEGORIES):
        abort(400, "Select a service category.")
    return cat


def duration(body):
    n = body.get("minutes", 30)
    if type(n) is not int or not 1 <= n <= 1440:
        abort(400, "Duration must be 1–1440 minutes.")
    return n


def instant(body, key):
    try:
        moment = datetime.fromisoformat(value(body, key, 50).replace("Z", "+00:00"))
        if moment.utcoffset() is None:
            raise ValueError
        return int(moment.timestamp())
    except (ValueError, OverflowError):
        abort(400, "Choose a valid date and time with a time zone.")


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def require(*roles):
    if not current_user.is_authenticated:
        abort(401, "Sign in to continue.")
    if current_user.role not in roles:
        abort(403, "Your account cannot perform this action.")


def row_or_404(query, args):
    row = database().execute(query, args).fetchone()
    if row is None:
        abort(404, "Record unavailable.")
    return row


def owned_service(sid, admin=False):
    roles = ("Provider", "Administrator") if admin else ("Provider",)
    require(*roles)
    s = row_or_404("SELECT * FROM services WHERE id=? AND removed=0", (sid,))
    if current_user.role != "Administrator" and s["provider_id"] != current_user.id:
        abort(403, "This listing belongs to another provider.")
    return s


def public_state():
    db = database()
    u = None
    if current_user.is_authenticated:
        u = dict(row_or_404(f"SELECT {PUBLIC_USER} FROM users WHERE id=?", (current_user.id,)))
    admin = bool(u and u["role"] == "Administrator")
    uid = u["id"] if u else 0
    records = db.execute("""
        SELECT s.*, u.name AS provider, u.bio AS profile, u.status AS providerStatus, u.active AS providerActive
        FROM services s JOIN users u ON u.id=s.provider_id
        WHERE s.removed=0 AND (? OR u.id=? OR (u.active AND u.status='approved' AND s.active AND s.approved))
        ORDER BY s.id""", (admin, uid)).fetchall()
    services = []
    for s in records:
        staff = admin or uid == s["provider_id"]
        times = db.execute("""
            SELECT t.*, EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=t.id
              AND b.status IN ('Pending','Confirmed')) AS reserved
            FROM slots t WHERE t.service_id=? AND t.removed=0 AND t.start>? ORDER BY t.start""",
            (s["id"], int(time.time()))).fetchall()
        services.append(dict(id=s["id"], name=s["name"], provider=s["provider"], providerId=s["provider_id"],
                             cat=s["category"], desc=s["description"], profile=s["profile"], mins=s["minutes"],
                             active=bool(s["active"]), approved=bool(s["approved"]), providerStatus=s["providerStatus"],
                             visible=bool(s["active"] and s["approved"] and s["providerActive"] and s["providerStatus"]=="approved"),
                             slots=[dict(id=t["id"], start=iso(t["start"]), end=iso(t["finish"]), reserved=bool(t["reserved"]))
                                    for t in times if staff or not t["reserved"]]))
    bookings = []
    if u:
        for b in db.execute("""SELECT b.*,c.name AS customer FROM bookings b JOIN users c ON c.id=b.customer_id
                              WHERE ? OR b.customer_id=? OR b.provider_id=? ORDER BY b.id DESC""", (admin, uid, uid)):
            bookings.append(dict(id=b["id"], customerId=b["customer_id"], customer=b["customer"], providerId=b["provider_id"],
                                 provider=b["provider_name"], name=b["service_name"], time=iso(b["start"]), end=iso(b["finish"]),
                                 status=b["status"], reason=b["reason"]))
    users = [dict(a) for a in db.execute(f"SELECT {PUBLIC_USER} FROM users ORDER BY id")] if admin else []
    problems = [dict(p) for p in db.execute("SELECT * FROM problems ORDER BY id DESC")] if admin else []
    return dict(user=u, services=services, bookings=bookings, users=users, problems=problems,
                adminReady=bool(db.execute("SELECT 1 FROM users WHERE role='Administrator'").fetchone()))


def create_app(directory=None, *, production=False):
    folder = Path(directory or os.environ.get("INTERVAL_DATA_DIR") or ROOT / "instance")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "interval.sqlite3"
    db = connect(path)
    try:
        db.executescript((ROOT / "backend/schema.sql").read_text())
        db.execute("INSERT OR IGNORE INTO settings VALUES('secret',?)", (secrets.token_hex(32),))
        secret = db.execute("SELECT value FROM settings WHERE name='secret'").fetchone()[0]
        db.execute("INSERT OR IGNORE INTO settings VALUES('activation','')")
    finally:
        db.close()
    app = Flask(__name__, template_folder=str(ROOT / "web/public"), static_folder=str(ROOT / "web/public"), static_url_path="")
    app.config.update(SECRET_KEY=secret, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12), MAX_CONTENT_LENGTH=32768)
    app.config.update(SESSION_COOKIE_SECURE=production, SESSION_REFRESH_EACH_REQUEST=False)
    app.config["DATABASE"] = path
    login = LoginManager(app)

    cleanup_lock = Lock()
    next_cleanup = 0.0

    @app.before_request
    def prepare():
        nonlocal next_cleanup
        g.database_path = path
        tick = time.monotonic()
        if tick >= next_cleanup and cleanup_lock.acquire(blocking=False):
            try:
                if tick >= next_cleanup:
                    database().execute("DELETE FROM auth_limits WHERE expiry<=?", (int(time.time()),))
                    next_cleanup = tick + 600
            finally:
                cleanup_lock.release()
        if request.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            if not request.is_json or request.headers.get("X-Interval-Action") != "1":
                abort(403, "Send requests from the Interval application.")
            if not isinstance(request.get_json(), dict):
                abort(400, "Expected a JSON object.")

    @app.teardown_appcontext
    def close(_error):
        if "db" in g:
            g.db.close()

    @login.user_loader
    def load(identity):
        parts = identity.split(".")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            return None
        row = database().execute("""SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
            WHERE u.id=? AND u.version=? AND u.active=1 AND s.token=? AND s.expiry>?""",
            (*parts, session.get("token"), int(time.time()))).fetchone()
        return Account(row) if row else None

    @app.after_request
    def headers(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        if production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(HTTPException)
    def error(exc):
        return jsonify(error=exc.description), exc.code

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/state")
    def state():
        return public_state()

    @app.get("/healthz")
    def health():
        database().execute("SELECT id FROM users LIMIT 1").fetchone()
        return {"status":"ok"}

    def limit_auth(kind, email):
        # Independent account and address budgets also work across server restarts.
        now = int(time.time())
        buckets = [(kind + ":email:" + email.casefold(), 12),
                   (kind + ":ip:" + (request.remote_addr or "local"), 100)]
        with transaction() as db:

            for identifier, maximum in buckets:
                key = hashlib.sha256(identifier.encode()).hexdigest()
                db.execute("""INSERT INTO auth_limits VALUES(?,1,?)
                    ON CONFLICT(bucket) DO UPDATE SET
                    count=CASE WHEN expiry<=? THEN 1 ELSE count+1 END,
                    expiry=CASE WHEN expiry<=? THEN excluded.expiry ELSE expiry END""",
                    (key,now+600,now,now))
                if db.execute("SELECT count FROM auth_limits WHERE bucket=?", (key,)).fetchone()[0] > maximum:
                    abort(429, "Too many attempts. Try again in ten minutes.")

    def authenticate(row, persistent=False):
        now = int(time.time())
        token = secrets.token_urlsafe(32)
        with transaction() as db:
            db.execute("DELETE FROM sessions WHERE token=? OR expiry<=?", (session.get("token"),now))
            db.execute("INSERT INTO sessions VALUES(?,?,?)", (token,row["id"],now+43200))
        session.clear()
        session["token"] = token
        login_user(Account(row))
        session.permanent = persistent
        return {"ok": True}

    @app.post("/api/register")
    def register():
        b = request.json
        role = b.get("role")
        if role not in ("Customer","Provider","Administrator"):
            abort(400, "Choose a role.")
        name = value(b, "name", 90)
        email = value(b, "email", 254).lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            abort(400, "Enter a valid email address.")
        password = b.get("password")
        if not isinstance(password,str) or not 8 <= len(password) <= 256:
            abort(400, "Choose a password of 8–256 characters.")
        professional = role == "Provider"
        cat = category(b) if professional else ""
        bio = value(b,"bio",500) if professional else ""
        service = value(b,"service",90) if professional else ""
        description = service
        if professional and "serviceDescription" in b:
            description = value(b, "serviceDescription", 500)
        limit_auth("register",email)
        password_hash = generate_password_hash(password)
        with transaction() as db:
            if role == "Administrator":
                if db.execute("SELECT 1 FROM users WHERE role='Administrator'").fetchone():
                    abort(403,"Administrator account already exists.")
                if email != ADMIN_EMAIL:
                    abort(400,"Use the administrator email address.")
            elif email == ADMIN_EMAIL:
                abort(400,"Use another email address.")
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                abort(409,"An account already uses this email.")
            uid = db.execute("""INSERT INTO users(name,email,password_hash,role,status,category,bio)
                                VALUES(?,?,?,?,?,?,?)""",(name,email,password_hash,role,"pending" if professional else "active",cat,bio)).lastrowid
            if professional:
                db.execute("INSERT INTO services(provider_id,name,category,description,minutes) VALUES(?,?,?,?,30)",(uid,service,cat,description))
            row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return authenticate(row), 201

    @app.post("/api/login")
    def signin():
        b = request.json
        email = value(b,"email",254).lower()
        limit_auth("login",email)
        password = b.get("password")
        row = database().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if (not row or not row["active"] or row["role"] != b.get("role") or not isinstance(password,str)
                or len(password)>256 or not check_password_hash(row["password_hash"], password)):
            abort(401,"Sign-in failed. Check your email and password, then select the workspace you registered for (Customer, Provider or Administrator).")
        return authenticate(row, persistent=request.json.get("remember") == "on")

    @app.post("/api/logout")
    def signout():
        database().execute("DELETE FROM sessions WHERE token=?", (session.get("token"),))
        logout_user()
        session.clear()
        return {"ok":True}

    @app.post("/api/users/<int:uid>")
    def manage_user(uid):
        with transaction() as db:
            require("Administrator")
            row = row_or_404("SELECT role,status FROM users WHERE id=?", (uid,))
            if row["role"]=="Administrator":
                abort(403,"The administrator account cannot be changed here.")
            b = request.json
            if b.get("status") in ("approved","rejected") and row["role"]=="Provider":
                db.execute("UPDATE users SET status=? WHERE id=?", (b["status"],uid))
            elif type(b.get("active")) is bool:
                db.execute("UPDATE users SET active=?,version=version+1 WHERE id=?", (b["active"],uid))
            else:
                abort(400,"Choose an account action.")
        return {"ok":True}

    @app.post("/api/profile")
    def profile():
        with transaction() as db:
            require("Provider")
            db.execute("UPDATE users SET name=?,bio=?,category=? WHERE id=?",
                       (value(request.json,"name",90),value(request.json,"bio",500),category(request.json),current_user.id))
        return {"ok":True}

    @app.post("/api/password")
    def change_password():
        require("Administrator", "Provider", "Customer")
        b = request.json
        password = b.get("password")
        if not isinstance(password, str) or not 8 <= len(password) <= 256:
            abort(400, "Choose a password of 8–256 characters.")
        with transaction() as db:
            db.execute("UPDATE users SET password_hash=? WHERE id=?",
                       (generate_password_hash(password), current_user.id))
        return {"ok": True}

    @app.post("/api/admin/reset")
    def reset_admin():
        require("Administrator")
        with transaction() as db:
            db.execute("DELETE FROM sessions WHERE user_id=?", (current_user.id,))
            db.execute("DELETE FROM users WHERE id=? AND role='Administrator'", (current_user.id,))
        logout_user()
        session.clear()
        return {"ok": True}

    @app.post("/api/services")
    @app.post("/api/services/<int:sid>")
    def services(sid=None):
        b=request.json
        with transaction() as db:
            if sid is None:
                require("Provider")
                db.execute("INSERT INTO services(provider_id,name,category,description,minutes) VALUES(?,?,?,?,?)",
                           (current_user.id,value(b,"name",90),category(b),value(b,"description",500),duration(b)))
            else:
                owned_service(sid,admin=True)
                if b.get("remove") is True:
                    db.execute("UPDATE services SET removed=1 WHERE id=?",(sid,))
                elif type(b.get("active")) is bool:
                    require("Provider")
                    db.execute("UPDATE services SET active=? WHERE id=?",(b["active"],sid))
                elif type(b.get("approved")) is bool:
                    require("Administrator")
                    db.execute("UPDATE services SET approved=? WHERE id=?",(b["approved"],sid))
                else:
                    db.execute("UPDATE services SET name=?,category=?,description=?,minutes=? WHERE id=?",
                               (value(b,"name",90),category(b),value(b,"description",500),duration(b),sid))
        return {"ok":True}

    @app.post("/api/services/<int:sid>/slots")
    @app.post("/api/services/<int:sid>/slots/<int:tid>")
    def slots(sid,tid=None):
        b=request.json
        with transaction() as db:
            owned_service(sid)
            if tid is not None:
                row_or_404("SELECT id FROM slots WHERE id=? AND service_id=? AND removed=0",(tid,sid))
                if db.execute("SELECT 1 FROM bookings WHERE slot_id=? AND status IN ('Pending','Confirmed')",(tid,)).fetchone():
                    abort(409,"A reserved slot cannot be changed.")
            if tid is not None and b.get("remove") is True:
                db.execute("UPDATE slots SET removed=1 WHERE id=?",(tid,))
            else:
                start,finish=instant(b,"start"),instant(b,"end")
                if start<=time.time() or finish<=start:
                    abort(400,"Choose a future start and a later end.")
                busy=db.execute("""SELECT 1 FROM slots t JOIN services s ON s.id=t.service_id
                    WHERE s.provider_id=? AND t.removed=0 AND (s.removed=0 OR EXISTS
                    (SELECT 1 FROM bookings WHERE slot_id=t.id AND status IN ('Pending','Confirmed')))
                    AND t.id!=? AND t.start<? AND t.finish>?""",(current_user.id,tid or 0,finish,start)).fetchone()
                if busy:
                    abort(409,"This interval overlaps another slot in your schedule.")
                if tid is None:
                    db.execute("INSERT INTO slots(service_id,start,finish) VALUES(?,?,?)",(sid,start,finish))
                else:
                    db.execute("UPDATE slots SET start=?,finish=? WHERE id=?",(start,finish,tid))
        return {"ok":True}

    @app.post("/api/bookings")
    def reserve():
        with transaction() as db:
            require("Customer")
            tid=request.json.get("slot")
            if type(tid) is not int:
                abort(400,"Select a slot.")
            s=row_or_404("""SELECT t.*,s.provider_id,s.name,u.name AS provider FROM slots t
               JOIN services s ON s.id=t.service_id JOIN users u ON u.id=s.provider_id WHERE t.id=?
               AND t.removed=0 AND s.removed=0 AND s.active AND s.approved AND u.active AND u.status='approved'""",(tid,))
            if s["start"]<=time.time():
                abort(409,"This time has already passed.")
            try:
                db.execute("""INSERT INTO bookings(slot_id,customer_id,provider_id,service_name,provider_name,
                              start,finish,reason,status) VALUES(?,?,?,?,?,?,?,?,'Pending')""",
                           (tid,current_user.id,s["provider_id"],s["name"],s["provider"],s["start"],s["finish"],
                            value(request.json,"reason",400,optional=True)))
            except sqlite3.IntegrityError:
                abort(409,"That time was just reserved. Choose another slot.")
        return {"ok":True},201

    @app.post("/api/bookings/<int:bid>")
    def decision(bid):
        with transaction() as db:
            require("Provider","Customer")
            b=row_or_404("SELECT * FROM bookings WHERE id=?",(bid,))
            target=request.json.get("status")
            if current_user.role=="Customer":
                if current_user.id!=b["customer_id"]:
                    abort(403,"This booking belongs to another customer.")
                allowed=target=="Cancelled" and b["status"] in ("Pending","Confirmed") and b["start"]>time.time()
            else:
                if current_user.id!=b["provider_id"]:
                    abort(403,"This request belongs to another provider.")
                allowed=(b["status"]=="Pending" and target in ("Confirmed","Rejected")
                         or b["status"]=="Confirmed" and (target=="Cancelled" or target=="Completed" and b["finish"]<=time.time()))
            if not allowed:
                abort(409,"This change is unavailable for the current time or booking status.")
            db.execute("UPDATE bookings SET status=? WHERE id=?",(target,bid))
        return {"ok": True}

    @app.post("/api/bookings/<int:bid>/problems")
    def report(bid):
        with transaction() as db:
            require("Customer","Provider")
            row_or_404("SELECT id FROM bookings WHERE id=? AND (customer_id=? OR provider_id=?)",(bid,current_user.id,current_user.id))
            db.execute("INSERT INTO problems(booking_id,reporter,message) VALUES(?,?,?)",(bid,current_user.id,value(request.json,"message",500)))
        return {"ok":True}

    @app.post("/api/problems/<int:pid>/resolve")
    def resolve(pid):
        with transaction() as db:
            require("Administrator")
            row_or_404("SELECT id FROM problems WHERE id=?",(pid,))
            db.execute("UPDATE problems SET resolved=1 WHERE id=?",(pid,))
        return {"ok":True}
    return app
