$("joinForm").onsubmit=async e=>{e.preventDefault();$("joinError").textContent="";
 try{const d=await api("/api/player/join",{method:"POST",body:JSON.stringify({nickname:new FormData(e.target).get("nickname")})});playerToken=d.token;playerId=d.player_id;
 localStorage.setItem("birthdayPlayerToken",playerToken);localStorage.setItem("birthdayPlayerId",playerId);
 $("playerName").textContent=`Welcome, ${new FormData(e.target).get("nickname")}!`;showScreen("waiting");}
 catch(err){$("joinError").textContent=err.message;}};

async function recoverPlayer(){
 const token=localStorage.getItem("birthdayPlayerToken");if(!token)return;
 playerToken=token;playerId=localStorage.getItem("birthdayPlayerId")||"";
 try{const d=await api("/api/player/state",{headers:{"X-Player-Token":playerToken}});
 $("playerName").textContent=`Welcome back, ${d.player.nickname}!`;
 if(d.state.status==="RUNNING"){
    if(d.player.finished){showScreen("finished");await showLeaderboard()}
    else{showScreen("game");await startPlayerRound()}
 } else {
    showScreen("waiting");
    $("waitingText").textContent = "Waiting for the next game to start...";
 }
 }catch(e){localStorage.removeItem("birthdayPlayerToken");localStorage.removeItem("birthdayPlayerId");}
}

async function startPlayerRound(){
 try{
 const d=await api("/api/player/round",{headers:{"X-Player-Token":playerToken}});
 if(d.status==="FINISHED"){showScreen("finished");await showLeaderboard();return}
 if(d.status!=="RUNNING"){showScreen("waiting");return}

 currentRound=d;showScreen("game");
 $("roundLabel").textContent=`GAME ${d.state?.game_number || 1} - ROUND ${d.round} OF 3`;
 
 $("revealArea").classList.add("hidden");
 document.querySelector(".game-layout").classList.remove("hidden");

 if(d.options && d.options.length > 0){
     // Player already solved the puzzle in a previous session. Show options.
     $("puzzleArea").classList.add("hidden");
     $("optionsArea").classList.remove("hidden");
     showOptions(d.options);
 } else {
     // Normal flow: Show puzzle, hide options
     $("puzzleArea").classList.remove("hidden");
     $("optionsArea").classList.add("hidden");
     $("answerMessage").textContent="";
     $("puzzleMessage").textContent="";
     $("checkPuzzle").disabled = false;
     initPuzzle(d.photo.url, d.tiles?.order);
 }
 }catch(e){$("puzzleMessage").textContent=e.message}
}

function showOptions(options){
   $("options").innerHTML="";
   options.forEach(o=>{
     const b=document.createElement("button");
     b.className="option";
     const letter=document.createElement("b");letter.textContent=o.key;
     b.append(letter,document.createTextNode(o.label));
     b.onclick=()=>submitAnswer(o.label);
     $("options").append(b);
   });
}

async function submitAnswer(label){
 if(!currentRound || currentRound.answer_verified)return;
 [...$("options").querySelectorAll("button")].forEach(b=>{b.disabled=true;if(b.textContent.slice(1).trim()===label)b.classList.add("chosen")});
 try{
 const d=await api("/api/player/answer",{method:"POST",headers:{"X-Player-Token":playerToken},body:JSON.stringify({label})});
 currentRound.answer_verified=true;
 showRoundReveal(d.reveal, d.finished);
 }catch(e){$("answerMessage").textContent=e.message;[...$("options").querySelectorAll("button")].forEach(b=>b.disabled=false)}
}

function showRoundReveal(reveal, finished){
 document.querySelector(".game-layout").classList.add("hidden");
 
 $("revealArea").classList.remove("hidden");
 $("revealImage").src = reveal.photo_url;
 $("revealTitle").textContent = reveal.guess_correct ? "Correct! 🎉" : "Not quite!";
 $("revealTitle").style.color = reveal.guess_correct ? "#13834b" : "#b91c50";
 
 $("revealResultText").textContent = reveal.guess_correct 
   ? `You correctly identified ${reveal.photo_name}.`
   : `You guessed "${reveal.guess_label}", but it was ${reveal.photo_name}.`;
 $("revealResultText").style.color = "var(--navy)";

 const nextBtn = $("revealNext");
 nextBtn.textContent = finished ? "SEE FINAL SCORES" : "NEXT ROUND →";
 nextBtn.onclick = async () => {
   nextBtn.disabled = true;
   if(finished){ showScreen("finished"); await showLeaderboard(); }
   else { await startPlayerRound(); }
   nextBtn.disabled = false;
 };
}

async function showLeaderboard(){
 try{
   const d=await api("/api/player/state",{headers:{"X-Player-Token":playerToken}});
   const box=$("leaderboard"); box.innerHTML="";
   const results = d.state.current_game_results || [];
   if(results.length === 0) box.innerHTML = "<p>No one has finished yet.</p>";
   else {
     results.forEach((r,i)=>{
       const line=document.createElement("div");
       line.className="playerline";
       line.innerHTML = `<span>${["🥇","🥈","🥉"][i]||"🏁"} ${i+1}. ${r.nickname}</span> <span>Score: ${r.score}/3 | Time: ${(r.elapsed_ms/1000).toFixed(2)} s</span>`;
       box.append(line);
     });
   }
   $("finishMessage").textContent = "Waiting for Admin to show the Audience Screen...";
 }catch(e){}
}

recoverPlayer();