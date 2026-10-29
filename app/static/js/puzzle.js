function initPuzzle(imageUrl, order){
 const grid=$("puzzleGrid");
 grid.innerHTML="";
 grid.style.gap="2px"; grid.style.padding="2px"; grid.style.background="#fff";

 const baseOrder=(order&&order.length===9)?order.slice():shuffledOrder();
 puzzleOrder=isSolved(baseOrder)?shuffledOrder():baseOrder;
 selectedTile=null;

 puzzleOrder.forEach((sourceIndex,destIndex)=>{
   const tile=document.createElement("button");
   tile.type="button";tile.className="tile";
   tile.dataset.source=sourceIndex;tile.dataset.dest=destIndex;
   tile.style.backgroundImage=`url("${imageUrl}")`;
   tile.style.backgroundSize="300% 300%";
   tile.style.border="1px solid #ccc";
   const sx=sourceIndex%3, sy=Math.floor(sourceIndex/3);
   tile.style.backgroundPosition=`${sx*50}% ${sy*50}%`;
   tile.draggable=true;tile.setAttribute("aria-label",`Puzzle piece ${destIndex+1}`);
   tile.onclick=()=>tapTile(tile);
   tile.addEventListener("dragstart",e=>{draggedTile=tile;e.dataTransfer.setData("text/plain",destIndex);});
   tile.addEventListener("dragover",e=>e.preventDefault());
   tile.addEventListener("drop",e=>{e.preventDefault();const from=draggedTile||grid.querySelector(`[data-dest="${e.dataTransfer.getData("text/plain")}"]`);if(from&&from!==tile)swapTiles(from,tile);draggedTile=null;});
   grid.append(tile);
 });
 $("puzzleMessage").textContent="";
}

function shuffledOrder(){
 const arr=[0,1,2,3,4,5,6,7,8];
 do{
   for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
 }while(isSolved(arr));
 return arr;
}

function isSolved(order){return order.every((v,i)=>v===i);}

function tapTile(tile){
 if(!selectedTile){selectedTile=tile;tile.classList.add("selected");return}
 if(selectedTile===tile){tile.classList.remove("selected");selectedTile=null;return}
 swapTiles(selectedTile,tile);selectedTile=null;
}

function swapTiles(a,b){
 const temp=a.dataset.source;a.dataset.source=b.dataset.source;b.dataset.source=temp;
 const update=tile=>{const src=Number(tile.dataset.source),x=src%3,y=Math.floor(src/3);tile.style.backgroundPosition=`${x*50}% ${y*50}%`;};
 update(a);update(b);a.classList.remove("selected");b.classList.remove("selected");
 
 // Send the new order to the server for the Admin's "Live View"
 const tiles=[...$("puzzleGrid").querySelectorAll(".tile")];
 const order=tiles.map(t=>Number(t.dataset.source));
 api("/api/player/move", {method:"POST", headers:{"X-Player-Token":playerToken}, body: JSON.stringify({order})}).catch(()=>{});
}

$("checkPuzzle").onclick=async()=>{
 const tiles=[...$("puzzleGrid").querySelectorAll(".tile")];
 const order=tiles.map(t=>Number(t.dataset.source));

 if(order.some((x,i)=>x!==i)){
   $("puzzleMessage").textContent="Almost! Keep arranging the pieces.";
   $("puzzleMessage").className="message";
   return;
 }

 const grid=$("puzzleGrid");
 grid.style.gap="0";
 grid.style.padding="0";
 grid.style.background="transparent";
 tiles.forEach(t=>{t.style.border="0";t.style.borderRadius="0"});

 $("checkPuzzle").disabled=true;
 try{
   const d=await api("/api/player/puzzle/submit",{method:"POST",headers:{"X-Player-Token":playerToken},body:JSON.stringify({order})});
   if(d.correct){
       $("puzzleMessage").textContent=d.message;
       $("puzzleMessage").className="message success";
       setTimeout(() => {
         $("puzzleArea").classList.add("hidden");
         $("optionsArea").classList.remove("hidden");
         showOptions(d.options);
       }, 1000);
   } else {
       $("puzzleMessage").textContent=d.message;
       $("puzzleMessage").className="message";
   }
 }catch(e){
   grid.style.gap="2px";grid.style.padding="2px";grid.style.background="#fff";
   tiles.forEach(t=>{t.style.border="1px solid #ccc";t.style.borderRadius="2px"});
   $("puzzleMessage").textContent=e.message;
   $("puzzleMessage").className="message";
 }
 finally{$("checkPuzzle").disabled=false}
};
