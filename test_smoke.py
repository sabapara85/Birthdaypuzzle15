from fastapi.testclient import TestClient
from app.main import app

def test_health():
    c=TestClient(app)
    assert c.get("/health").json()["ok"] is True

def test_homepage():
    c=TestClient(app)
    r=c.get("/")
    assert r.status_code==200
    assert "Happy Birthday" in r.text
