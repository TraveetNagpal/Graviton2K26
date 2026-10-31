from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
ORIGIN = "https://terramind-ai.vercel.app"


def test_preflight_allows_browser_origin():
    response = client.options(
        "/api/ai/investigate",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] in ("*", ORIGIN)


def test_simple_request_exposes_cors_header():
    response = client.get("/api/earth-engine/status", headers={"Origin": ORIGIN})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] in ("*", ORIGIN)
