(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const state = { file:null, frames:[], index:0, timer:null, delay:700, stream:null, detector:null, scanTimer:null, received:new Map(), transferId:null, total:0, filename:"", hash:"", doneBlob:null, swReady:false, qrReady:false };

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let v=n, i=-1;
    do { v/=1024; i++; } while (v>=1024 && i<units.length-1);
    return v.toFixed(v>=100?0:v>=10?1:2) + " " + units[i];
  }
  function b64(bytes) {
    let binary="";
    for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
    return btoa(binary);
  }
  function unb64(text) {
    const binary=atob(text), bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
  function hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function sha256Hex(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (window.crypto && window.crypto.subtle) return hex(await window.crypto.subtle.digest("SHA-256", bytes));
    // Private LAN HTTP pages are not secure contexts, so Web Crypto may be unavailable.
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength); padded.set(bytes); padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bits = bytes.length * 8;
    view.setUint32(paddedLength - 8, Math.floor(bits / 0x100000000));
    view.setUint32(paddedLength - 4, bits >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x,n) => (x >>> n) | (x << (32-n));
    for (let offset=0; offset<paddedLength; offset+=64) {
      for (let i=0;i<16;i++) w[i]=view.getUint32(offset+i*4);
      for (let i=16;i<64;i++) {
        const x=w[i-15], y=w[i-2];
        const s0=rotr(x,7)^rotr(x,18)^(x>>>3), s1=rotr(y,17)^rotr(y,19)^(y>>>10);
        w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
      }
      let [a,b,c,d,e,f,g,h]=H;
      for (let i=0;i<64;i++) {
        const s1=rotr(e,6)^rotr(e,11)^rotr(e,25), ch=(e&f)^(~e&g);
        const t1=(h+s1+ch+K[i]+w[i])>>>0;
        const s0=rotr(a,2)^rotr(a,13)^rotr(a,22), maj=(a&b)^(a&c)^(b&c);
        const t2=(s0+maj)>>>0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    return H.map(x=>x.toString(16).padStart(8,"0")).join("");
  }
  function setOfflineStatus(text,kind) {
    el("offline-status").textContent=text;
    el("offline-dot").className="dot"+(kind?" "+kind:"");
  }
  function updateOfflineStatus() {
    if (state.swReady && state.qrReady) {
      setOfflineStatus(navigator.onLine ? "App ready · disconnect internet to transfer" : "App ready · offline", "ready");
    } else {
      setOfflineStatus(navigator.onLine ? "Loading offline assets…" : "Offline cache not ready", "bad");
    }
  }
  window.addEventListener("online", updateOfflineStatus);
  window.addEventListener("offline", updateOfflineStatus);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then(async reg => {
      try { await navigator.serviceWorker.ready; state.swReady=true; } catch (_) {}
      if(reg.active) state.swReady=true;
      updateOfflineStatus();
    }).catch(() => setOfflineStatus("Offline cache unavailable", "bad"));
  } else {
    setOfflineStatus("Service workers unavailable in this browser", "bad");
  }
  function checkCameraSupport() {
    const supported = ("BarcodeDetector" in window) && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    el("start-scan").disabled=!supported;
    if(!supported) {
      el("camera-placeholder").classList.remove("hidden");
      el("camera-placeholder").querySelector("strong").textContent="QR scanning unsupported";
      el("camera-placeholder").querySelector("small").textContent="Use a recent supported browser, such as Android Chrome. Camera frames are processed locally.";
      el("receive-status").textContent="This browser lacks camera QR scanning support";
    }
    return supported;
  }
  function showMode(mode) {
    const sending=mode==="send", receiving=mode==="receive", local=mode==="local";
    el("send-panel").classList.toggle("hidden",!sending);
    el("receive-panel").classList.toggle("hidden",!receiving);
    el("local-panel").classList.toggle("hidden",!local);
    for (const [id,active] of [["send-tab",sending],["receive-tab",receiving],["local-tab",local]]) {
      el(id).classList.toggle("active",active);
      el(id).setAttribute("aria-selected",String(active));
    }
    if(receiving) checkCameraSupport();
    if(local) { checkLocalServer(); refreshLocalFiles(); }
  }
  el("send-tab").addEventListener("click",()=>showMode("send"));
  el("receive-tab").addEventListener("click",()=>showMode("receive"));
  el("local-tab").addEventListener("click",()=>showMode("local"));

  const localToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  let localFile = null;
  let localMaxFileBytes = 50 * 1024 ** 3;
  let localChunkSize = 8 * 1024 * 1024;
  const localApi = path => path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(localToken);
  async function checkLocalServer() {
    if (!localToken) {
      el("local-status").textContent = "Local server not detected. Start server.py and open its printed pairing link.";
      el("local-host").textContent = "Not connected";
      return false;
    }
    try {
      const r=await fetch(localApi("/api/info"),{cache:"no-store"});
      if(!r.ok) throw new Error("Server rejected the session");
      const info=await r.json();
      localMaxFileBytes=Number(info.max_file_bytes)||localMaxFileBytes;
      localChunkSize=Number(info.chunk_size)||localChunkSize;
      el("local-status").textContent="Connected · "+info.name+" · up to "+formatBytes(localMaxFileBytes)+" per file";
      el("local-host").textContent=location.origin;
      el("local-copy").disabled=false;
      el("local-upload").disabled=!localFile || localFile.size>localMaxFileBytes;
      if(localFile && localFile.size>localMaxFileBytes) el("local-status").textContent="File exceeds server limit of "+formatBytes(localMaxFileBytes);
      return true;
    } catch (_) {
      el("local-status").textContent="Cannot reach local server. Open QRDrop from the Python server's pairing link.";
      el("local-host").textContent=location.origin;
      return false;
    }
  }
  async function refreshLocalFiles() {
    if(!localToken) return;
    try {
      const r=await fetch(localApi("/api/files"),{cache:"no-store"});
      if(!r.ok) throw new Error("Could not list files");
      const data=await r.json(), root=el("local-files");
      root.replaceChildren();
      el("local-file-count").textContent=data.files.length+" file"+(data.files.length===1?"":"s");
      if(!data.files.length) { const p=document.createElement("p"); p.className="hint"; p.textContent="No files yet. Upload one here or from another device."; root.append(p); return; }
      for(const file of data.files) {
        const row=document.createElement("div"); row.className="local-file-row";
        const meta=document.createElement("div"); meta.className="local-file-meta";
        const name=document.createElement("strong"); name.textContent=file.name;
        const detail=document.createElement("small"); detail.textContent=formatBytes(file.size)+" · SHA-256 "+file.sha256.slice(0,12)+"…";
        meta.append(name,detail);
        const actions=document.createElement("div"); actions.className="local-file-actions";
        const download=document.createElement("a"); download.className="secondary local-download"; download.href=file.url; download.textContent="Download"; download.setAttribute("rel","noreferrer");
        const remove=document.createElement("button"); remove.type="button"; remove.className="secondary"; remove.textContent="Delete";
        remove.addEventListener("click",async()=>{ if(!confirm("Delete "+file.name+" from this device?")) return; const d=await fetch(localApi("/api/files?name="+encodeURIComponent(file.name)),{method:"DELETE"}); if(d.ok) refreshLocalFiles(); else el("local-status").textContent="Delete failed"; });
        actions.append(download,remove); row.append(meta,actions); root.append(row);
      }
    } catch (_) { el("local-status").textContent="Could not load files. Check the server and pairing link."; }
  }
  el("local-file-input").addEventListener("change",e=>{
    localFile=e.target.files && e.target.files[0] || null;
    el("local-file-label").textContent=localFile ? localFile.name+" · "+formatBytes(localFile.size) : "Choose a file to upload";
    const tooLarge=!!localFile && localFile.size>localMaxFileBytes;
    el("local-upload").disabled=!localFile || !localToken || tooLarge;
    if(tooLarge) el("local-status").textContent="File is "+formatBytes(localFile.size)+"; server limit is "+formatBytes(localMaxFileBytes)+". Increase --max-file-size-gib when starting the server.";
  });
  async function localJson(path, options={}) {
    const response=await fetch(localApi(path),{cache:"no-store",...options});
    let data={}; try { data=await response.json(); } catch (_) {}
    if(!response.ok) throw new Error(data.error||"Request failed (HTTP "+response.status+")");
    return data;
  }
  function sendUploadChunk(path, blob, chunkHash, onProgress) {
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("POST",localApi(path));
      xhr.setRequestHeader("Content-Type","application/octet-stream");
      xhr.setRequestHeader("X-QRDrop-Hash",chunkHash);
      xhr.upload.onprogress=e=>{if(e.lengthComputable) onProgress(e.loaded);};
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText)}catch(_){} 
        if(xhr.status>=200&&xhr.status<300) resolve(data);
        else {const err=new Error(data.error||"Chunk failed (HTTP "+xhr.status+")");err.status=xhr.status;err.offset=data.offset;reject(err);}
      };
      xhr.onerror=()=>reject(new Error("Network connection interrupted"));
      xhr.send(blob);
    });
  }
  el("local-upload").addEventListener("click",async()=>{
    if(!localFile || !localToken) return;
    const file=localFile;
    if(file.size>localMaxFileBytes) { el("local-status").textContent="File exceeds server limit of "+formatBytes(localMaxFileBytes); return; }
    el("local-upload").disabled=true;
    el("local-status").textContent="Preparing resumable upload · "+file.name;
    el("local-percent").textContent="0%"; el("local-progress").style.width="0%";
    let uploadId="";
    const sessionKey="qrdrop-upload-session";
    try {
      // Reuse the previous session after a page refresh when the same file is selected again.
      try {
        const saved=JSON.parse(sessionStorage.getItem(sessionKey)||"null");
        if(saved && saved.name===file.name && saved.size===file.size && saved.lastModified===file.lastModified) {
          const status=await localJson("/api/upload/status?id="+encodeURIComponent(saved.id));
          uploadId=saved.id;
          el("local-status").textContent="Resuming upload · "+formatBytes(status.offset)+" already received";
        }
      } catch (_) { uploadId=""; }
      if(!uploadId) {
        const started=await localJson("/api/upload/start?name="+encodeURIComponent(file.name)+"&size="+file.size,{method:"POST"});
        uploadId=started.id;
        sessionStorage.setItem(sessionKey,JSON.stringify({id:uploadId,name:file.name,size:file.size,lastModified:file.lastModified}));
      }
      const chunkSize=Number(status.chunk_size)||localChunkSize;
      let status=await localJson("/api/upload/status?id="+encodeURIComponent(uploadId));
      let offset=status.offset;
      while(offset<file.size) {
        const chunkStart=offset;
        const chunk=file.slice(chunkStart,Math.min(chunkStart+chunkSize,file.size));
        const chunkHash=await sha256Hex(await chunk.arrayBuffer());
        let accepted=false;
        for(let attempt=0;attempt<4&&!accepted;attempt++) {
          try {
            const result=await sendUploadChunk("/api/upload/chunk?id="+encodeURIComponent(uploadId)+"&offset="+chunkStart,chunk,chunkHash,loaded=>{
              const pct=Math.min(99,Math.floor((chunkStart+loaded)/Math.max(file.size,1)*100));
              el("local-percent").textContent=pct+"%"; el("local-progress").style.width=pct+"%";
            });
            offset=result.offset; accepted=true;
          } catch(err) {
            // A response may be lost after the server committed a chunk. Ask for its
            // acknowledged offset before retrying, so the same bytes are never appended twice.
            try {
              status=await localJson("/api/upload/status?id="+encodeURIComponent(uploadId));
              offset=status.offset;
              if(offset>chunkStart) accepted=true;
            } catch (_) {}
            if(!accepted && attempt===3) throw err;
          }
        }
        const pct=Math.floor(offset/Math.max(file.size,1)*100);
        el("local-percent").textContent=pct+"%"; el("local-progress").style.width=pct+"%";
        el("local-status").textContent="Uploading · "+formatBytes(offset)+" / "+formatBytes(file.size);
      }
      const result=await localJson("/api/upload/finish?id="+encodeURIComponent(uploadId),{method:"POST"});
      sessionStorage.removeItem(sessionKey);
      el("local-status").textContent="Upload complete · SHA-256 recorded · "+result.name;
      localFile=null; el("local-file-input").value=""; el("local-file-label").textContent="Choose a file to upload";
      el("local-percent").textContent="100%"; el("local-progress").style.width="100%";
      await refreshLocalFiles();
    } catch(err) { el("local-status").textContent=(err.message||"Upload failed")+". Select the same file again to resume."; }
    finally { el("local-upload").disabled=!localFile || !localToken; }
  });
  el("local-refresh").addEventListener("click",refreshLocalFiles);
  el("local-copy").addEventListener("click",async()=>{
    try { await navigator.clipboard.writeText(location.origin); el("local-status").textContent="Local address copied"; }
    catch(_) { el("local-status").textContent="Copy unavailable; share this address manually: "+location.origin; }
  });
  el("frame-delay").addEventListener("input",()=>{
    state.delay=Number(el("frame-delay").value);
    el("delay-label").textContent=state.delay+" ms";
    if(state.timer) { pauseSending(); startSending(); }
  });

  function renderFrame(i) {
    if(!state.frames.length || !window.QRCode) return;
    state.index=i;
    el("qrcode").innerHTML="";
    new QRCode(el("qrcode"), {text:state.frames[i],width:320,height:320,correctLevel:QRCode.CorrectLevel.L});
    el("frame-count").textContent="Frame "+(i+1)+" / "+state.frames.length;
    el("send-percent").textContent=Math.round((i+1)/state.frames.length*100)+"%";
    el("send-progress").style.width=((i+1)/state.frames.length*100)+"%";
  }
  async function prepareFile(file) {
    stopSending();
    state.file=file; state.frames=[]; state.index=0;
    if(!file) {
      el("file-label").textContent="Choose a file";
      el("file-info").classList.add("hidden");
      el("start-send").disabled=true;
      return;
    }
    el("file-label").textContent=file.name;
    el("file-info").classList.remove("hidden");
    el("file-info").textContent=file.name+" · "+formatBytes(file.size)+" · processed in this browser";
    el("send-status").textContent="Preparing QR frames…";
    el("send-percent").textContent="0%";
    el("send-progress").style.width="0%";
    el("start-send").disabled=true;
    try {
      const raw=new Uint8Array(await file.arrayBuffer());
      const id=Array.from(crypto.getRandomValues(new Uint8Array(5))).map(v=>v.toString(16).padStart(2,"0")).join("");
      const name64=b64(enc.encode(file.name));
      const digest=hex(await crypto.subtle.digest("SHA-256",raw));
      const size=1200, total=Math.max(1,Math.ceil(raw.length/size)), frames=[];
      for(let seq=0;seq<total;seq++) {
        const chunk=raw.subarray(seq*size,Math.min(raw.length,(seq+1)*size));
        frames.push("QDROP1|"+id+"|"+seq+"|"+total+"|"+name64+"|"+digest+"|"+b64(chunk));
      }
      if(!window.QRCode) throw new Error("Local QR generator is not ready. Reload the page after it has finished loading.");
      state.frames=frames; state.qrReady=true;
      el("qr-placeholder").classList.add("hidden");
      el("qr-display").classList.remove("hidden");
      renderFrame(0);
      el("send-status").textContent="Ready · "+total.toLocaleString()+" QR frames";
      el("start-send").disabled=false;
      updateOfflineStatus();
    } catch(err) {
      el("send-status").textContent=err.message||"Could not prepare file";
      el("start-send").disabled=true;
    }
  }
  el("file-input").addEventListener("change",e=>prepareFile(e.target.files && e.target.files[0]));
  function startSending() {
    if(!state.frames.length || state.timer) return;
    el("start-send").disabled=true; el("stop-send").disabled=false;
    el("send-status").textContent="Sending · keep the QR visible to the camera";
    renderFrame(state.index);
    state.timer=setInterval(()=>renderFrame((state.index+1)%state.frames.length),state.delay);
  }
  function pauseSending() {
    if(state.timer) clearInterval(state.timer);
    state.timer=null;
    el("start-send").disabled=!state.frames.length;
    el("stop-send").disabled=true;
    if(state.frames.length) el("send-status").textContent="Paused · start again to continue cycling frames";
  }
  function stopSending() {
    pauseSending();
    if(state.frames.length) { state.index=0; renderFrame(0); el("send-percent").textContent="0%"; el("send-progress").style.width="0%"; }
  }
  el("start-send").addEventListener("click",startSending);
  el("stop-send").addEventListener("click",pauseSending);

  async function startScanning() {
    if(!checkCameraSupport()) return;
    try {
      state.detector=new BarcodeDetector({formats:["qr_code"]});
      state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
      el("camera").srcObject=state.stream;
      await el("camera").play();
      el("camera-placeholder").classList.add("hidden");
      el("start-scan").disabled=true; el("stop-scan").disabled=false;
      el("receive-status").textContent="Scanning for QRDrop frames…";
      scanLoop();
    } catch(err) {
      el("receive-status").textContent=err.name==="NotAllowedError"?"Camera permission denied":"Camera unavailable: "+err.message;
      el("camera-placeholder").classList.remove("hidden");
      el("camera-placeholder").querySelector("strong").textContent="Camera unavailable";
      el("camera-placeholder").querySelector("small").textContent="Allow camera access and use HTTPS or localhost.";
    }
  }
  async function scanLoop() {
    if(!state.stream) return;
    try {
      const items=await state.detector.detect(el("camera"));
      for(const item of items) if(item.rawValue) acceptFrame(item.rawValue);
    } catch (_) {}
    if(state.stream) state.scanTimer=setTimeout(scanLoop,60);
  }
  function resetReceive() {
    state.received=new Map(); state.transferId=null; state.total=0; state.filename=""; state.hash=""; state.doneBlob=null;
    el("frames-captured").textContent="0 / —";
    el("bytes-received").textContent="0 B";
    el("incoming-name").textContent="Not detected";
    el("receive-percent").textContent="0%";
    el("receive-progress").style.width="0%";
    el("complete-box").classList.add("hidden");
    el("save-file").disabled=false;
  }
  function acceptFrame(raw) {
    const p=raw.split("|");
    if(p.length!==7 || p[0]!=="QDROP1") return;
    const id=p[1], seq=Number(p[2]), total=Number(p[3]), name64=p[4], hash=p[5];
    if(!/^[a-f0-9]{10}$/.test(id) || !/^[a-f0-9]{64}$/.test(hash) || !Number.isInteger(seq) || !Number.isInteger(total) || total<1 || total>100000 || seq<0 || seq>=total) return;
    if(state.transferId && state.transferId!==id && state.received.size && !state.doneBlob) resetReceive();
    if(!state.transferId || state.transferId!==id) {
      state.transferId=id; state.total=total; state.hash=hash; state.received=new Map(); state.doneBlob=null;
      try { state.filename=dec.decode(unb64(name64)).slice(0,240)||"received-file"; } catch (_) { state.filename="received-file"; }
      el("incoming-name").textContent=state.filename;
      el("complete-box").classList.add("hidden");
    }
    if(total!==state.total || hash!==state.hash || state.received.has(seq)) return;
    let chunk;
    try { chunk=unb64(p[6]); } catch (_) { return; }
    state.received.set(seq,chunk);
    let totalBytes=0;
    for(const item of state.received.values()) totalBytes+=item.length;
    const pct=Math.floor(state.received.size/state.total*100);
    el("frames-captured").textContent=state.received.size+" / "+state.total;
    el("bytes-received").textContent=formatBytes(totalBytes);
    el("receive-percent").textContent=pct+"%";
    el("receive-progress").style.width=pct+"%";
    el("receive-status").textContent=state.received.size===state.total ? "All frames received · verifying file…" : "Captured frame "+(seq+1)+" · scanning for missing frames";
    if(state.received.size===state.total) finishReceive();
  }
  async function finishReceive() {
    try {
      const ordered=[];
      for(let i=0;i<state.total;i++) ordered.push(state.received.get(i));
      const blob=new Blob(ordered,{type:"application/octet-stream"});
      const digest=hex(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()));
      if(digest!==state.hash) {
        el("receive-status").textContent="Integrity check failed · scan the sender's frames again";
        resetReceive();
        stopScanning();
        return;
      }
      state.doneBlob=blob;
      el("complete-title").textContent=state.filename;
      el("complete-details").textContent=formatBytes(blob.size)+" · SHA-256 verified · not saved yet";
      el("complete-box").classList.remove("hidden");
      el("receive-status").textContent="SHA-256 verified · file reconstructed in memory";
      stopScanning();
    } catch (_) {
      el("receive-status").textContent="Could not reconstruct the file";
    }
  }
  function stopScanning() {
    if(state.scanTimer) clearTimeout(state.scanTimer);
    state.scanTimer=null;
    if(state.stream) state.stream.getTracks().forEach(track=>track.stop());
    state.stream=null;
    el("camera").srcObject=null;
    el("camera-placeholder").classList.remove("hidden");
    el("camera-placeholder").querySelector("strong").textContent=state.doneBlob?"Transfer complete":"Camera is off";
    el("camera-placeholder").querySelector("small").textContent=state.doneBlob?"The reconstructed file is ready to save.":"Start scanning to receive QR frames.";
    el("start-scan").disabled=!checkCameraSupport();
    el("stop-scan").disabled=true;
  }
  el("start-scan").addEventListener("click",startScanning);
  el("stop-scan").addEventListener("click",stopScanning);
  el("save-file").addEventListener("click",()=>{
    if(!state.doneBlob) return;
    const url=URL.createObjectURL(state.doneBlob), link=document.createElement("a");
    link.href=url; link.download=state.filename||"received-file"; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    // The recipient explicitly chose to save, so drop QRDrop's in-memory references.
    state.doneBlob=null;
    state.received.clear();
    el("save-file").disabled=true;
    el("save-file").textContent="Save requested";
    el("complete-details").textContent="Download requested. QRDrop has released its in-memory copy; the browser handles the saved file.";
    el("receive-status").textContent="Save requested · QRDrop released its in-memory data";
  });
  window.addEventListener("beforeunload",()=>{stopSending();stopScanning();state.doneBlob=null;});
  state.qrReady=!!window.QRCode;
  const waitQR=()=>{state.qrReady=!!window.QRCode;updateOfflineStatus();if(!state.qrReady)setTimeout(waitQR,250);};
  waitQR(); updateOfflineStatus();
})();