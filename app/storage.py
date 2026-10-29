"""Small JSON store. Upstash REST is authoritative when configured; local JSON is for development only."""
import json, os, threading, urllib.request, urllib.error
from urllib.parse import quote
from pathlib import Path

_LOCAL_PATH = Path(os.getenv("LOCAL_DATA_FILE", "local_data.json"))
_LOCK = threading.Lock()

def _request(method, key, value=None):
    from .config import UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
    if not UPSTASH_REDIS_REST_URL or not UPSTASH_REDIS_REST_TOKEN:
        return None
    encoded_key = quote(key, safe="")
    if value is None:
        url = UPSTASH_REDIS_REST_URL.rstrip("/") + "/get/" + encoded_key
    else:
        encoded_value = quote(json.dumps(value, separators=(",", ":")), safe="")
        url = UPSTASH_REDIS_REST_URL.rstrip("/") + "/set/" + encoded_key + "/" + encoded_value
    req = urllib.request.Request(url, method="GET", headers={"Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}"})
    with urllib.request.urlopen(req, timeout=8) as response:
        payload = json.loads(response.read().decode())
    return payload.get("result")

def get_json(key, default=None):
    try:
        result = _request("get", key)
        if result is not None:
            return json.loads(result) if isinstance(result, str) else result
        from .config import UPSTASH_REDIS_REST_URL
        if UPSTASH_REDIS_REST_URL:
            return default
    except Exception:
        from .config import UPSTASH_REDIS_REST_URL
        if UPSTASH_REDIS_REST_URL:
            raise
    with _LOCK:
        if _LOCAL_PATH.exists():
            data = json.loads(_LOCAL_PATH.read_text(encoding="utf-8"))
            return data.get(key, default)
    return default

def set_json(key, value):
    try:
        result = _request("set", key, value)
        from .config import UPSTASH_REDIS_REST_URL
        if UPSTASH_REDIS_REST_URL:
            return result
    except Exception:
        from .config import UPSTASH_REDIS_REST_URL
        if UPSTASH_REDIS_REST_URL:
            raise
    with _LOCK:
        data = json.loads(_LOCAL_PATH.read_text(encoding="utf-8")) if _LOCAL_PATH.exists() else {}
        data[key] = value
        _LOCAL_PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return "OK"