import os
from waitress import serve
from backend.server import connect, create_app

production = os.getenv("INTERVAL_ENV", "local")
if production not in {"local", "production"}:
    raise RuntimeError("INTERVAL_ENV must be local or production")
app = create_app(production=production == "production")

if __name__ == "__main__":
    if production == "local":
        db = connect(app.config["DATABASE"])
        key = db.execute("SELECT value FROM settings WHERE name='activation'").fetchone()[0]
        db.close()
        if key:
            print("First administrator setup key:", key, flush=True)
    host = os.getenv("INTERVAL_BIND", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    print(f"Interval listening on {host}:{port}", flush=True)
    proxy = {}
    if os.getenv("INTERVAL_BEHIND_PROXY") == "1":
        # Compose exposes only Caddy; Waitress receives traffic on its private network.
        proxy = dict(trusted_proxy="*", trusted_proxy_count=1,
                     trusted_proxy_headers={"x-forwarded-for", "x-forwarded-proto"})
    serve(app, **proxy, host=host, port=port, threads=4, max_request_body_size=32768,
          channel_timeout=60, ident="Interval")
