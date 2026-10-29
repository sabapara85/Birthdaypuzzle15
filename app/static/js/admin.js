let currentGameState = null;
let audienceIndex = 0;

$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginError").textContent="";
 const f=new FormData(e.target);try{await api("/api/admin/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});showScreen("admin");await loadAdmin();}
 catch(err){$("loginError").textContent=err.message;}};

$("uploadForm").onsubmit=async e=>{e.preventDefault();$("adminMsg").textContent="Uploading…";
 try{const data=await api("/api/admin/photos",{method:"POST",body:new FormData(e.target)});e.target.reset();$("adminMsg").textContent=`Uploaded "${data.name}"`;await loadAdmin();}
 catch(err){$("adminMsg").textContent=err.message;}};

$("refreshAdmin").onclick=loadAdmin;

async function loadAdmin(){
 try{
  const d=await api("/api/admin/state");currentGameState=d.state;
  renderGallery(d.photos,d.state.selected||[]);renderAdminState(d.state);
  $("currentGameNum").textContent = d.state.game_number;
  $("adminStatusBadge").textContent = d.state.status;
  
  $("startGame").classList.add("hidden");$("btnAudienceMode").classList.add("hidden");$("btnPrepareNext").classList.add("hidden");
  
  if(d.state.status === "WAITING"){ $("startGame").classList.remove("hidden"); }
  else if(d.state.status === "RUNNING"){ /* wait */ }
  else if(d.state.status === "AUDIENCE"){ $("btnPrepareNext").classList.remove("hidden"); }
  
  if(d.state.selected.length === 3 && d.state.status !== "WAITING"){
      $("btnAudienceMode").classList.remove("hidden");
  }
 }catch(err){$("adminMsg").textContent=err.message;if(err.message.includes("Admin"))showScreen("adminLogin");}
}

function renderGallery(photos,selected){
 $("photoCount").textContent=`${photos.length}/25`;const g=$("gallery"),s=$("selection");g.innerHTML="";s.innerHTML="";
 photos.forEach((p,i)=>{
  const card=document.createElement("div");card.className="photo-card";
  const img=document.createElement("img");img.src=p.url;img.alt=p.name;
  const title=document.createElement("strong");title.textContent=p.name;
  const tools=document.createElement("div");tools.className="tools";
  
  const del=document.createElement("button");del.className="btn small danger";del.textContent="Delete";
  del.onclick=async()=>{if(!confirm(`Delete "${p.name}"?`))return;try{await api(`/api/admin/photos/${p.id}`,{method:"DELETE"});await loadAdmin()}catch(e){alert(e.message)}};
  
  tools.append(del);card.append(img,title,tools);g.append(card);
  const lab=document.createElement("label");lab.className="select-item";const cb=document.createElement("input");cb.type="checkbox";cb.value=p.id;cb.checked=selected.some(x=>x.photo_id===p.id);
  cb.onchange = () => { if(document.querySelectorAll('#selection input:checked').length > 3) { cb.checked = false; alert('Select exactly 3 photos.'); } };
  const txt=document.createElement("span");txt.textContent=`${i+1}. ${p.name}`;lab.append(cb,txt);s.append(lab);
 });
}

$("saveSelection").onclick=async()=>{const ids=[...$("selection").querySelectorAll("input:checked")].map(x=>x.value);try{await api("/api/admin/select",{method:"POST",body:JSON.stringify({photo_ids:ids})});$("adminMsg").textContent="Selection saved.";await loadAdmin()}catch(e){$("adminMsg").textContent=e.message}};

$("startGame").onclick=async()=>{
 if(!confirm("Start the current game now? Players will immediately see Round 1."))return;
 try{await api("/api/admin/start",{method:"POST"});$("adminMsg").textContent="Game started!";await loadAdmin()}catch(e){$("adminMsg").textContent=e.message}
};

$("btnPrepareNext").onclick=async()=>{
 if(!confirm("Prepare the next game? This will reset the player rounds and let you select new photos."))return;
 try{await api("/api/admin/prepare_next_game",{method:"POST"});await loadAdmin();$("adminMsg").textContent="Ready for Game " + currentGameState.game_number;}catch(e){$("adminMsg").textContent=e.message}
};

$("btnResetGame").onclick = async () => {
    if(!confirm("⚠️ WARNING: This will kick all players out, delete all scores, and reset the game back to Game 1. Your uploaded photos will remain safe. Are you sure?")) return;
    try {
        await api("/api/admin/reset", {method:"POST"});
        await loadAdmin();
        $("adminMsg").textContent = "Game completely reset. Ready for a new competition.";
    } catch(e) {
        $("adminMsg").textContent = e.message;
    }
};

$("logout").onclick=async()=>{try{await api("/api/admin/logout",{method:"POST"});}catch{}showScreen("welcome")};

function renderAdminState(state){
 if(!state)return;
 const box=$("adminState");box.innerHTML=`<strong>Status: ${state.status}</strong><p>Players: ${state.players.length}</p>`;
 
 const liveGrid = document.createElement("div");
 liveGrid.className = "live-grid-container";
 
 state.players.forEach(p=>{
   const line=document.createElement("div");line.className="playerline";
   const n=document.createElement("span");n.textContent=p.nickname;
   const r=document.createElement("span");r.textContent=p.finished?"Finished Game":`Round ${Math.min(p.round+1,3)} / 3`;
   line.append(n,r);box.append(line);
   
   // Draw Live Mini Puzzle
   if(!p.finished && p.tiles && p.photo_url) {
       const mini = document.createElement("div");
       mini.className = "mini-puzzle";
       p.tiles.forEach(src => {
           const t = document.createElement("div");
           t.style.backgroundImage = `url("${p.photo_url}")`;
           t.style.backgroundSize = "300% 300%";
           const x = src % 3, y = Math.floor(src / 3);
           t.style.backgroundPosition = `${x*50}% ${y*50}%`;
           mini.append(t);
       });
       const wrap = document.createElement("div");
       wrap.className = "mini-wrap";
       wrap.append(document.createElement("p"), mini);
       wrap.querySelector("p").textContent = p.nickname;
       liveGrid.append(wrap);
   }
 });
 
 if(liveGrid.children.length > 0) {
     box.append(document.createElement("h4")).textContent = "🔴 Live Player Boards";
     box.append(liveGrid);
 }

 if(state.current_game_results?.length){
     const h=document.createElement("h4");h.textContent="Current Game Finishing Order";box.append(h);
     state.current_game_results.forEach((r,i)=>{
         const line=document.createElement("div");line.className="playerline";
         line.innerHTML=`<span>${i+1}. ${r.nickname}</span> <span>Score: ${r.score}/3 | Time: ${(r.elapsed_ms/1000).toFixed(2)} s</span>`;
         box.append(line);
     });
 }
}

// ================= AUDIENCE MODE LOGIC =================
$("btnAudienceMode").onclick = () => {
    if(!currentGameState || currentGameState.selected.length !== 3) return alert("No photos selected.");
    audienceIndex = 0;
    $("audienceWinnerBoard").classList.add("hidden");
    $("btnShowAudienceWinner").classList.add("hidden");
    $("btnNextAudience").classList.remove("hidden");
    $("audienceOverlay").classList.remove("hidden");
    showAudiencePhoto();
};

function showAudiencePhoto(){
    const p = currentGameState.selected[audienceIndex];
    $("audienceImage").src = p.url;
    $("audienceCounter").textContent = `Photo ${audienceIndex + 1} of 3`;
}

$("btnNextAudience").onclick = () => {
    audienceIndex++;
    if(audienceIndex < 3){
        showAudiencePhoto();
    } else {
        $("btnNextAudience").classList.add("hidden");
        $("btnShowAudienceWinner").classList.remove("hidden");
        $("audienceImage").src = ""; 
        $("audienceCounter").textContent = "Ready to reveal winner!";
    }
};

$("btnShowAudienceWinner").onclick = () => {
    $("btnShowAudienceWinner").classList.add("hidden");
    const board = $("audienceWinnerBoard");
    board.innerHTML = "<h2>🏆 GAME WINNERS 🏆</h2>";
    
    const results = currentGameState.current_game_results || [];
    if(results.length === 0){
        board.innerHTML += "<p style='text-align:center'>No one finished yet!</p>";
    } else {
        results.forEach((r, i) => {
            const line = document.createElement("div");
            line.className = "playerline";
            line.innerHTML = `<span>${["🥇","🥈","🥉"][i]||"🏁"} ${i+1}. ${r.nickname}</span> <span>Score: ${r.score}/3 | Time: ${(r.elapsed_ms/1000).toFixed(2)} s</span>`;
            board.append(line);
        });
    }
    board.classList.remove("hidden");
};

$("btnExitAudience").onclick = () => {
    $("audienceOverlay").classList.add("hidden");
    api("/api/admin/audience_mode", {method:"POST"}).catch(()=>{});
    setTimeout(loadAdmin, 500);
};
