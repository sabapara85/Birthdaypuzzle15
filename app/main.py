import base64, hashlib, hmac, html, io, json, random, secrets, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import storage
from .config import (APP_NAME, PUBLIC_BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD,
                     SESSION_SECRET, MAX_UPLOAD_MB, CLOUDINARY_CLOUD_NAME,
                     CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)

ROOT = Path(__file__).resolve().parent
app = FastAPI(title=APP_NAME)
app.add_middleware(CORSMiddleware, allow_origins=[PUBLIC_BASE_URL, "http://127.0.0.1:8000", "http://localhost:8000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

class Hub:
    def __init__(self): self.clients = set()
    async def broadcast(self, message):
        dead=[]
        for ws in list(self.clients):
            try: await ws.send_json(message)
            except Exception: dead.append(ws)
        for ws in dead: self.clients.discard(ws)
hub = Hub()

def now_ms(): return int(time.time() * 1000)
def load_photos(): return storage.get_json("photos", [])
def save_photos(items): storage.set_json("photos", items)

def load_game():
    default_game = {
        "status":"WAITING", # WAITING, RUNNING, AUDIENCE
        "game_id":secrets.token_hex(5),
        "game_number":1,
        "selected":[],
        "players":{},
        "current_game_results":[],
        "all_results":[],
        "created_at":now_ms(),
        "started_at":None
    }
    return storage.get_json("game", default_game)

def save_game(game): storage.set_json("game", game)
def token_hash(token): return hashlib.sha256(token.encode()).hexdigest()
def signed_cookie(value):
    sig=hmac.new(SESSION_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()
    return value+"."+sig
def verify_cookie(raw):
    if not raw or "." not in raw: return None
    value,sig=raw.rsplit(".",1)
    expected=hmac.new(SESSION_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()
    return value if hmac.compare_digest(sig, expected) else None
def is_admin(request):
    return verify_cookie(request.cookies.get("admin_session","")) == "admin"
def require_admin(request):
    if not is_admin(request): raise HTTPException(401, "Admin login required")
def public_photo(p):
    return {k:p[k] for k in ("id","name","url")}

def public_state(game=None):
    game=game or load_game()
    return {
        "status":game["status"],
        "game_number":game.get("game_number", 1),
        "selected":game.get("selected",[]),
        "players":[{
            "nickname": p["nickname"],
            "connected": p.get("connected",False),
            "round": p.get("round",0),
            "finished": p.get("finished",False),
            "tiles": p.get("tiles", {}).get("order") if p.get("tiles") else None,
            "photo_url": game["selected"][p["round"]]["url"] if p["round"] < 3 and p["round"] < len(game.get("selected", [])) else None
        } for p in game.get("players",{}).values()],
        "current_game_results":sorted(game.get("current_game_results",[]), key=lambda x: (-x.get("score", 0), x.get("elapsed_ms", 0)))
    }
async def notify():
    await hub.broadcast({"type":"state","state":public_state()})

@app.get("/", response_class=HTMLResponse)
def index():
    return (ROOT/"templates"/"index.html").read_text(encoding="utf-8")

@app.get("/api/public")
def public_config():
    g=load_game()
    return {"status":g["status"],"birthday":"Happy Birthday Krishiv","public_url":PUBLIC_BASE_URL,"game_id":g["game_id"]}

class Login(BaseModel):
    username: str
    password: str
@app.post("/api/admin/login")
def login(body: Login):
    if not (hmac.compare_digest(body.username, ADMIN_USERNAME) and hmac.compare_digest(body.password, ADMIN_PASSWORD)):
        raise HTTPException(401, "Incorrect username or password")
    response=JSONResponse({"ok":True})
    response.set_cookie("admin_session", signed_cookie("admin"), httponly=True, secure=PUBLIC_BASE_URL.startswith("https://"), samesite="lax", max_age=86400)
    return response
@app.post("/api/admin/logout")
def logout(request: Request):
    require_admin(request)
    response=JSONResponse({"ok":True}); response.delete_cookie("admin_session"); return response
@app.get("/api/admin/photos")
def admin_photos(request: Request):
    require_admin(request)
    return {"photos":[public_photo(p) for p in load_photos()]}

async def persist_image(upload: UploadFile, content: bytes) -> str:
    if CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET:
        try:
            import cloudinary, cloudinary.uploader
            cloudinary.config(cloud_name=CLOUDINARY_CLOUD_NAME, api_key=CLOUDINARY_API_KEY, api_secret=CLOUDINARY_API_SECRET, secure=True)
            result=cloudinary.uploader.upload(io.BytesIO(content), folder="krishiv-birthday", resource_type="image")
            return result["secure_url"]
        except Exception as e:
            print(f"CLOUDINARY ERROR: {e}")
            raise HTTPException(502, f"Image storage failed: {e}")
    return "data:"+ (upload.content_type or "image/jpeg")+";base64,"+base64.b64encode(content).decode()

@app.post("/api/admin/photos")
async def upload_photo(request: Request, name: str = Form(...), file: UploadFile = File(...)):
    require_admin(request)
    name=name.strip()
    if not name or len(name)>70: raise HTTPException(400, "Photo name must be 1–70 characters.")
    if file.content_type not in ("image/jpeg","image/png","image/webp"): raise HTTPException(400, "Use JPG, PNG or WebP.")
    content=await file.read()
    if len(content)>MAX_UPLOAD_MB*1024*1024: raise HTTPException(413, f"Maximum image size is {MAX_UPLOAD_MB} MB.")
    photos=load_photos()
    if len(photos)>=25: raise HTTPException(400, "Maximum 25 photos. Delete one before adding another.")
    url=await persist_image(file, content)
    p={"id":secrets.token_hex(8),"name":name,"url":url}
    photos.append(p); save_photos(photos)
    return public_photo(p)

@app.delete("/api/admin/photos/{photo_id}")
def delete_photo(photo_id: str, request: Request):
    require_admin(request)
    photos=[p for p in load_photos() if p["id"]!=photo_id]
    save_photos(photos)
    return {"ok":True}

class Selection(BaseModel): photo_ids: list[str]
@app.post("/api/admin/select")
async def select_photos(body: Selection, request: Request):
    require_admin(request)
    if len(body.photo_ids)!=3 or len(set(body.photo_ids))!=3: raise HTTPException(400,"Select exactly 3 different photos.")
    photos=load_photos()
    if len(photos)<4: raise HTTPException(400,"Upload at least 4 named photos to create four answer choices.")
    byid={p["id"]:p for p in photos}
    if any(pid not in byid for pid in body.photo_ids): raise HTTPException(400,"One or more photos no longer exist.")
    g=load_game()
    if g["status"]=="RUNNING": raise HTTPException(409,"Cannot change selection during a running game.")
    g["selected"]=[{"photo_id":pid,"name":byid[pid]["name"],"url":byid[pid]["url"]} for pid in body.photo_ids]
    save_game(g); await notify()
    return {"ok":True,"selected":g["selected"]}

@app.get("/api/admin/state")
def admin_state(request: Request):
    require_admin(request)
    g = load_game()
    return {"state":public_state(g), "photos":[public_photo(p) for p in load_photos()],"public_url":PUBLIC_BASE_URL}

@app.post("/api/admin/start")
async def start_game(request: Request):
    require_admin(request)
    g=load_game()
    if g["status"]=="RUNNING": raise HTTPException(409,"Game already running.")
    if len(g.get("selected",[]))!=3: raise HTTPException(400,"Select exactly three photos before starting.")
    
    g["status"]="RUNNING"; 
    g["started_at"]=now_ms(); 
    g["current_game_results"]=[]
    
    for p in g["players"].values():
        p.update({"round":0,"finished":False,"round_started_at":g["started_at"],"correct_photo_id":None,"options":None,"tiles":None,"completed_rounds":[]})
    
    print(f"DEBUG: Game {g['game_number']} STARTED.")
    save_game(g); await notify()
    return {"ok":True,"state":public_state(g)}

@app.post("/api/admin/prepare_next_game")
async def prepare_next_game(request: Request):
    require_admin(request)
    g=load_game()
    if g["status"]=="RUNNING": raise HTTPException(409,"Cannot prepare next game while current game is running.")
    
    g["status"]="WAITING"
    g["game_number"] = g.get("game_number", 1) + 1
    g["selected"]=[]
    
    if g.get("current_game_results"):
        g["all_results"].append({"game": g["game_number"] - 1, "results": g["current_game_results"]})
    
    for p in g["players"].values():
        p.update({"round":0,"finished":False,"options":None,"tiles":None})
        
    print(f"DEBUG: Prepared Game {g['game_number']}.")
    save_game(g); await notify()
    return {"ok":True}

@app.post("/api/admin/audience_mode")
async def audience_mode(request: Request):
    require_admin(request)
    g=load_game()
    g["status"]="AUDIENCE"
    save_game(g); await notify()
    return {"ok":True}

@app.post("/api/admin/reset")
async def reset_game(request: Request):
    require_admin(request)
    new={"status":"WAITING","game_id":secrets.token_hex(5),"game_number":1,"selected":[],"players":{},"current_game_results":[],"all_results":[],"created_at":now_ms(),"started_at":None}
    save_game(new); await notify(); return {"ok":True}

class Join(BaseModel): nickname: str
@app.post("/api/player/join")
async def join(body: Join):
    nickname=body.nickname.strip()
    if not nickname or len(nickname)>20: raise HTTPException(400,"Nickname must be 1–20 characters.")
    g=load_game()
    if g["status"] not in ["WAITING", "RUNNING", "AUDIENCE"]: raise HTTPException(409,"This competition has already started.")
    if any(p["nickname"].casefold()==nickname.casefold() for p in g["players"].values()): raise HTTPException(409,"That nickname is already taken. Please choose another.")
    player_id=secrets.token_hex(8); token=secrets.token_urlsafe(32)
    g["players"][player_id]={"id":player_id,"nickname":nickname,"token_hash":token_hash(token),"connected":True,"round":0,"finished":False,"registered_at":now_ms(),"completed_rounds":[]}
    save_game(g)
    await notify()
    response=JSONResponse({"ok":True,"player_id":player_id,"token":token,"state":public_state(g)})
    response.set_cookie("player_session", token, httponly=True, secure=PUBLIC_BASE_URL.startswith("https://"), samesite="lax", max_age=86400)
    return response

def find_player(g, request):
    tok=request.cookies.get("player_session")
    if not tok: tok=request.headers.get("x-player-token")
    if not tok: raise HTTPException(401,"Join the game first.")
    th=token_hash(tok)
    return next((p for p in g["players"].values() if hmac.compare_digest(p["token_hash"],th)),None)

@app.get("/api/player/state")
def player_state(request: Request):
    g=load_game(); p=find_player(g,request)
    if not p: raise HTTPException(401,"Player session expired. Please rejoin.")
    return {"state":public_state(g),"player":{"nickname":p["nickname"],"round":p["round"],"finished":p["finished"]}}

def make_round(g,p):
    idx=p["round"]
    if idx>=3: return None
    selected=g["selected"][idx]
    
    p["correct_photo_id"]=selected["photo_id"]
    p["answer_verified"]=False
    p["guess_label"]=None
    p["options"]=None
    
    order=random.sample(list(range(9)),9)
    while order==list(range(9)):
        order=random.sample(list(range(9)),9)
    p["tiles"]={"order":order,"verified":False}
    p["round_started_at"]=now_ms()
    return {"round":idx+1,"photo":{"id":selected["photo_id"],"url":selected["url"]}}

@app.get("/api/player/round")
def get_round(request: Request):
    g=load_game(); p=find_player(g,request)
    if not p: raise HTTPException(401,"Join the game first.")
    if g["status"]!="RUNNING": return {"status":g["status"]}
    if p["finished"]: return {"status":"FINISHED"}
    
    if not p.get("tiles"):
        result = make_round(g,p)
        save_game(g)
        result.update({"status":"RUNNING","options":None})
        return result
        
    idx=p["round"]; selected=g["selected"][idx]
    return {"status":"RUNNING","round":idx+1,"photo":{"id":selected["photo_id"],"url":selected["url"]},"options":p.get("options"),"tiles":p.get("tiles")}

class PuzzleSubmit(BaseModel): order: list[int]

@app.post("/api/player/move")
async def submit_move(body: PuzzleSubmit, request: Request):
    g=load_game(); p=find_player(g,request)
    if p and p.get("tiles") and g["status"]=="RUNNING":
        p["tiles"]["order"] = body.order
        save_game(g); await notify()
    return {"ok":True}

@app.post("/api/player/puzzle/submit")
async def submit_puzzle(body: PuzzleSubmit, request: Request):
    g=load_game(); p=find_player(g,request)
    if not p: raise HTTPException(401,"Join the game first.")
    if g["status"]!="RUNNING" or p["finished"]: raise HTTPException(409,"Round is not active.")
    if len(body.order)!=9 or sorted(body.order)!=list(range(9)): raise HTTPException(400,"Invalid puzzle arrangement.")
    
    if body.order!=list(range(9)): 
        return {"correct":False,"message":"Not solved yet."}
        
    if not p.get("options"):
        idx=p["round"]
        selected=g["selected"][idx]
        photos=load_photos()
        distractors=[x["name"] for x in photos if x["id"]!=selected["photo_id"]]
        random.shuffle(distractors)
        opts=[{"label":selected["name"],"correct":True}]
        opts += [{"label":name,"correct":False} for name in distractors[:3]]
        random.shuffle(opts)
        p["options"]=[{"key":chr(65+i),"label":x["label"]} for i,x in enumerate(opts)]
        save_game(g)

    return {"correct":True,"message":"Puzzle solved! Now select the correct name.","options":p["options"]}

class Answer(BaseModel): label: str
@app.post("/api/player/answer")
async def submit_answer(body: Answer, request: Request):
    g=load_game(); p=find_player(g,request)
    if not p: raise HTTPException(401,"Join the game first.")
    if g["status"]!="RUNNING" or p["finished"]: raise HTTPException(409,"Round is not active.")
    if not p.get("options"): raise HTTPException(409,"Solve the puzzle first.")
    if p.get("answer_verified"): raise HTTPException(409,"Already answered.")
    
    valid_labels={o["label"] for o in p.get("options",[])}
    if body.label not in valid_labels: raise HTTPException(400,"Invalid choice.")
    
    p["guess_label"]=body.label
    p["answer_verified"]=True
    
    selected=g["selected"][p["round"]]
    guess_correct = (body.label == selected["name"])
    elapsed = now_ms() - p["round_started_at"]
    
    p["completed_rounds"].append({"round":p["round"]+1,"elapsed_ms":elapsed,"completed_at":now_ms(),"guess_correct":guess_correct})
    
    reveal={"round":p["round"]+1,"photo_url":selected["url"],"photo_name":selected["name"],
            "guess_label":body.label,"guess_correct":guess_correct}
            
    p["round"]+=1; p["options"]=None; p["answer_verified"]=False; p["guess_label"]=None; p["tiles"]=None
    
    if p["round"]>=3:
        p["finished"]=True; finish=now_ms()
        score = sum(1 for r in p["completed_rounds"] if r["guess_correct"])
        g["current_game_results"]=[r for r in g["current_game_results"] if r["player_id"]!=p["id"]]
        g["current_game_results"].append({"player_id":p["id"],"nickname":p["nickname"],"finish_ms":finish,"elapsed_ms":finish-g["started_at"], "score":score})
        response={"finished":True,"message":"You completed all three rounds!","reveal":reveal, "score":score}
        print(f"DEBUG: Player {p['nickname']} FINISHED. Score: {score}/3. Time: {elapsed}ms")
    else:
        response={"finished":False,"next_round":p["round"]+1,"message":"Next round!","reveal":reveal}
        print(f"DEBUG: Player {p['nickname']} finished Round {p['round']}.")
        
    save_game(g); await notify(); return response

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept(); hub.clients.add(ws)
    try:
        await ws.send_json({"type":"state","state":public_state()})
        while True: await ws.receive_text()
    except WebSocketDisconnect: hub.clients.discard(ws)
    except Exception: hub.clients.discard(ws)

@app.get("/health")
def health(): return {"ok":True}
