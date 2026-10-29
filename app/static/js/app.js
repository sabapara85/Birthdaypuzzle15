const $ = (id) => document.getElementById(id);
const screens = ["welcome","adminLogin","admin","playerJoin","waiting","game","finished"];
function showScreen(id){screens.forEach(s=>$(s).classList.toggle("hidden",s!==id));}
document.querySelectorAll("[data-back]").forEach(b=>b.addEventListener("click",()=>showScreen("welcome")));
$("showAdmin").onclick=()=>showScreen("adminLogin");
$("showPlayer").onclick=()=>showScreen("playerJoin");

function showError(msg) {
  const banner = $("errorBanner");
  banner.textContent = msg;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 5000);
}

async function api(url, options={}) {
  try {
    const opts={...options, headers:{...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),...(options.headers||{})}, credentials:"same-origin"};
    const res=await fetch(url,opts); let data={}; try{data=await res.json()}catch{}
    if(!res.ok) throw new Error(data.detail||data.message||`Request failed (${res.status})`);
    return data;
  } catch(err) {
    showError(err.message);
    throw err;
  }
}

let playerToken="", playerId="", currentRound=null, puzzleOrder=[], selectedTile=null, draggedTile=null;
let ws=null;
function connectWS(){
 try{const proto=location.protocol==="https:"?"wss":"ws";ws=new WebSocket(`${proto}://${location.host}/ws`);
 ws.onmessage=(e)=>{
   const msg=JSON.parse(e.data);
   if(msg.type==="state"){
     if(!$("admin").classList.contains("hidden"))renderAdminState(msg.state);
     if(!$("waiting").classList.contains("hidden")&&msg.state.status==="RUNNING")startPlayerRound();
   }
 };
 ws.onclose=()=>setTimeout(connectWS,1800);}catch(e){}
}
connectWS();