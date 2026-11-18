"""Local interactive browser test. Open the printed URL in Chrome or Firefox."""
import secrets
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flask import Response, request
from backend.server import ADMIN_EMAIL, create_app


def browser_app(directory):
    app = create_app(directory)
    password = secrets.token_urlsafe(18)
    @app.get("/__check")
    def check():
        return Response(f'''<!doctype html><title>Interval browser acceptance check</title>
        <h1>Interval browser acceptance check</h1><pre id="result" role="status">Running…</pre>
        <iframe title="Application under test" height="840" width="1280" src="/"></iframe>
        <script data-password="{password}" src="/__check.js"></script>''',mimetype="text/html")

    @app.get("/__check.js")
    def check_script():
        return Response(Path(__file__).with_name("browser_check.js").read_text(encoding="utf-8"),mimetype="text/javascript")
    @app.post("/__compete")
    def competing_customer():
        # This fixture exists only on this temporary test server.
        slot=request.json["slot"]
        headers={"X-Interval-Action":"1"}
        with app.test_client() as other:
            registration=other.post("/api/register", json=dict(name="Second customer",role="Customer",
                email=secrets.token_hex(8)+"@example.test",password=secrets.token_urlsafe(20)),headers=headers)
            assert registration.status_code==201
            result=other.post("/api/bookings",json={"slot":slot},headers=headers)
            return {"reserved":result.status_code==201},result.status_code

    # Only this isolated test server embeds the application in an iframe.
    original=app.after_request_funcs[None][0]
    def embedded(response):
        response=original(response)
        response.headers["X-Frame-Options"]="SAMEORIGIN"
        response.headers["Content-Security-Policy"]=response.headers["Content-Security-Policy"].replace("frame-ancestors 'none'","frame-ancestors 'self'")
        return response
    app.after_request_funcs[None][0]=embedded
    if not app.test_client().get("/api/state").json.get("adminReady"):
        with app.test_client() as client:
            assert client.post("/api/register", json=dict(name="Test administrator", role="Administrator",
                email=ADMIN_EMAIL,password=password),headers={"X-Interval-Action":"1"}).status_code==201

    return app

if __name__=="__main__":
    from waitress import serve
    with TemporaryDirectory() as tmp:
        print("Open http://127.0.0.1:5051/__check",flush=True)
        serve(browser_app(tmp),host="127.0.0.1",port=5051)
