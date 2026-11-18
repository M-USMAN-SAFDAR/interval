"""Offline administration. Run on the host that owns the persistent database."""
import argparse
from contextlib import closing
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile

from datetime import datetime, timedelta, timezone
from backend.server import ROOT, connect, create_app, ADMIN_EMAIL


def copy_database(source, target, restoring=False):
    """Publish a verified SQLite snapshot to a new path. Never overwrite live data."""
    source, target = Path(source).resolve(strict=True), Path(target).resolve()
    if target.exists():
        raise FileExistsError(f"Choose an unused destination: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, staged = tempfile.mkstemp(dir=target.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(source.as_uri()+"?mode=ro",uri=True)) as original, closing(connect(staged)) as output:
            original.backup(output)
            if output.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database integrity check failed.")
            tables = {r[0] for r in output.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"bookings","settings","services","slots","users","problems"}.issubset(tables):
                raise ValueError("Expected an Interval database.")
            if output.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("Broken database references.")
            if restoring:
                if "sessions" in tables:
                    output.execute("DELETE FROM sessions")
                output.execute("UPDATE settings SET value=? WHERE name='secret'", (secrets.token_hex(32),))
                output.execute("UPDATE settings SET value=? WHERE name='activation' AND value!=''",(secrets.token_urlsafe(24),))
        # Both operations publish a complete snapshot and refuse an existing target.
        if os.name == "nt":
            os.rename(staged, target)
        else:
            os.link(staged, target)
    finally:
        Path(staged).unlink(missing_ok=True)


def make_demo(directory):
    """Create a separate rehearsal installation with generated credentials."""
    directory = Path(directory)
    directory.mkdir(parents=True,exist_ok=False)
    app = create_app(directory)
    headers = {"X-Interval-Action":"1"}
    admin,provider,customer = (app.test_client() for _ in range(3))
    credentials = []
    def submit(client,path,body):
        response=client.post("/api/"+path,json=body,headers=headers)
        if response.status_code not in (200,201):
            raise RuntimeError(response.json["error"])
    def enroll(client,role,name,email,**fields):
        password=secrets.token_urlsafe(16)
        submit(client,"register",dict(role=role,name=name,email=email,password=password,**fields))
        credentials.append((role,email,password))
    enroll(admin,"Administrator","Demo manager",ADMIN_EMAIL)
    enroll(provider,"Provider","Demo tutor","tutor@example.test",category="Education",
           bio="One-to-one programming and mathematics tutoring.",service="Programming lesson",
           serviceDescription="Practice programming with guided exercises and individual feedback.")
    uid=provider.get("/api/state").json["user"]["id"]
    submit(admin,f"users/{uid}",{"status":"approved"})
    submit(provider,"services",dict(name="Mathematics lesson",category="Education",description="Algebra practice.",minutes=45))
    start=(datetime.now(timezone.utc)+timedelta(days=2)).replace(hour=10,minute=0,second=0,microsecond=0)
    for idx,item in enumerate(provider.get("/api/state").json["services"]):
        when=start+timedelta(hours=idx)
        submit(provider,f"services/{item['id']}/slots",dict(start=when.isoformat(),end=(when+timedelta(minutes=item['mins'])).isoformat()))
    enroll(customer,"Customer","Demo learner","learner@example.test")
    for client in (admin,provider,customer):
        submit(client,"logout",{})
    return credentials


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest="command",required=True)
    commands.add_parser("demo").add_argument("new_directory",type=Path)
    commands.add_parser("backup").add_argument("destination",type=Path)
    restore=commands.add_parser("restore")
    restore.add_argument("source",type=Path)
    restore.add_argument("new_directory",type=Path)
    args=parser.parse_args()
    live=Path(os.getenv("INTERVAL_DATA_DIR",ROOT/"instance"))/"interval.sqlite3"
    if args.command=="demo":
        for role,email,password in make_demo(args.new_directory):
            print(role,email,password)
    elif args.command=="restore":
        copy_database(args.source,args.new_directory/"interval.sqlite3",True)
    elif args.command=="backup":
        copy_database(live,args.destination)

if __name__=="__main__":
    main()
