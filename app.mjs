import {parseMidi,handFor,practiceGroups} from './midi.mjs';
const $=id=>document.getElementById(id), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const timeLabel=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const noteName=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);
let song=null, position=0, playing=false, practicing=false, ctx,master,piano,audioPromise;
let anchorTime=0,anchorPosition=0,nextNote=0,timer,rate=1,startGeneration=0,importGeneration=0;
let loopA=0,loopB=0,steps=[],stepIndex=0,hits=new Set(),completed=false,octave=4;
let pdf=null,pdfTask=null,pages=[],pageIndex=0,renderGeneration=0,renderTask=null,sheetGeneration=0;
let anchors=[],anchorHistory=[],marking=false,markTime=0,view='roll',sheetBusy=false,midiAccess=null;
const held=new Map(),voices=new Map(),pedals=new Set(),pedalVoices=new Map(),keys=new Map(),midiInputs=new Map();
let wrongUntil=0,wrongNote=-1,rollWindow={start:0,span:10},displayedPage=-1,rollMin=36,rollMax=91,lastFocus=-1;
function notice(message,ok=false){$('notice').textContent=message;$('notice').classList.toggle('success',ok);$('notice').hidden=!message;}
function safe(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{notice(e.message||String(e));updateTransport();});}
function hand(n){return handFor(n,song.tracks);}
function now(){return playing?clamp(anchorPosition+(ctx.currentTime-anchorTime)*rate,0,song.duration):position;}
function inLoop(){return $('loop').checked&&loopB>loopA+.05;}
async function audioReady(){
  if(!ctx){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('当前浏览器不支持 Web Audio。');ctx=new Audio();master=ctx.createGain();master.gain.value=+$('volume').value/100*.85;master.connect(ctx.destination);piano=new SamplePiano(ctx,master,s=>$('audioStatus').textContent=s);}
  await ctx.resume();if(!audioPromise)audioPromise=piano.ready().catch(e=>{audioPromise=null;throw e;});await audioPromise;
}
function releaseAll(){for(const v of voices.values())v?.stop?.();for(const list of pedalVoices.values())for(const v of list)v?.stop?.();voices.clear();pedalVoices.clear();pedals.clear();held.clear();}
function stop(){position=now();playing=false;practicing=false;startGeneration++;clearInterval(timer);piano?.silence();releaseAll();updateTransport();}
function schedule(){
  if(!playing)return;const current=now(),end=inLoop()?loopB:song.duration;
  while(nextNote<song.notes.length){const n=song.notes[nextNote];if(n.time>current+.22*rate||n.time>=end)break;nextNote++;if(hand(n)==='off'||n.end<current-.05)continue;
    const start=Math.max(current,n.time);piano.play(n.midi,ctx.currentTime+Math.max(0,(start-current)/rate),(Math.min(n.end,end)-start)/rate,hand(n),n.velocity,{offset:Math.max(0,current-n.time)});
  }
}
function beginPlayback(){
  playing=true;practicing=false;anchorTime=ctx.currentTime;anchorPosition=position;nextNote=0;
  while(nextNote<song.notes.length&&song.notes[nextNote].time<position-.001){const n=song.notes[nextNote++];if(n.end>position&&hand(n)!=='off')piano.play(n.midi,ctx.currentTime,(Math.min(n.end,inLoop()?loopB:song.duration)-position)/rate,hand(n),n.velocity,{offset:position-n.time});}
  schedule();timer=setInterval(schedule,25);updateTransport();
}
function rebuildSteps(){steps=song?practiceGroups(song.notes,song.tracks,$('hand').value):[];locateStep();}
function locateStep(){stepIndex=steps.findIndex(s=>s.time>=position-.04);if(stepIndex<0)stepIndex=steps.length;hits.clear();completed=false;}
async function start(){
  if(!song)return;if(playing||practicing){stop();return;}
  if(!song.notes.some(n=>hand(n)!=='off'))throw Error('请在「声部分配」中启用至少一条音轨。');
  if(position>=song.duration-.01)position=0;
  if(inLoop()&&(position<loopA||position>=loopB))position=loopA;
  const generation=++startGeneration;$('play').textContent='音色加载中…';await audioReady();if(generation!==startGeneration)return;
  if($('mode').value==='practice'){rebuildSteps();if(!steps.length)throw Error('当前声部没有可练习的音符，请调整声部分配。');if(stepIndex>=steps.length){position=inLoop()?loopA:0;locateStep();}if(inLoop()&&(!steps[stepIndex]||steps[stepIndex].time>=loopB))throw Error('循环片段内没有当前声部的音符。');practicing=true;position=steps[stepIndex].time;renderPractice();updateTransport();}
  else beginPlayback();
}
function seek(t,resume=false){const wasPlaying=playing,wasPracticing=practicing;stop();position=clamp(t,0,song?.duration||0);locateStep();if(resume&&wasPlaying)beginPlayback();else if(resume&&wasPracticing&&steps[stepIndex]){practicing=true;position=steps[stepIndex].time;}updateTransport();renderPractice();}
function updateTransport(){const running=playing||practicing;$('play').textContent=running?'Ⅱ 暂停':($('mode').value==='practice'?'▶ 开始跟练':'▶ 开始播放');$('play').disabled=!song;$('reset').disabled=!song;$('progress').disabled=!song;$('clear').disabled=!song&&!pages.length;for(const id of ['setA','setB'])$(id).disabled=!song;$('addAnchor').disabled=!song||!pages.length;$('undoAnchor').disabled=!anchors.length;}
function renderPractice(){
  const step=steps[stepIndex];$('practiceCount').textContent=`${Math.min(stepIndex,steps.length)} / ${steps.length}`;
  $('practicePrompt').textContent=completed?'这一遍完成了，做得好。':practicing&&step?'请弹：'+step.notes.filter(n=>!hits.has(n)).map(noteName).join(' · '):'准备好了，就点击「开始跟练」';
  $('practiceDetail').textContent=completed?'回到开头再练一次，或换一首曲目。':'按齐提示音后前进，错音不会跳过。和弦可以逐个按下。';
}
function practicePress(n){
  if(!practicing)return;const step=steps[stepIndex];if(!step)return;
  if(!step.notes.includes(n)){wrongNote=n;wrongUntil=performance.now()+450;return;}
  hits.add(n);if(step.notes.every(n=>hits.has(n))){stepIndex++;hits.clear();
    if(inLoop()&&(!steps[stepIndex]||steps[stepIndex].time>=loopB)){position=loopA;locateStep();}
    if(stepIndex>=steps.length){stop();completed=true;position=song.duration;}
    else position=steps[stepIndex].time;
  }renderPractice();
}
function inputDown(n,source,velocity=.8){
  if(held.has(source))return;held.set(source,n);practicePress(n);
  const token={};voices.set(source,token);
  if(!$('monitor').checked)return;
  audioReady().then(()=>{if(!held.has(source)||voices.get(source)!==token)return;voices.set(source,piano.play(n,ctx.currentTime,Infinity,n<60?'L':'R',velocity));}).catch(e=>{notice(e.message);});
}
function inputUp(source){held.delete(source);const voice=voices.get(source);voices.delete(source);if(!voice?.release)return;const channel=source.split(':').slice(0,-1).join(':');if(pedals.has(channel)){if(!pedalVoices.has(channel))pedalVoices.set(channel,[]);pedalVoices.get(channel).push(voice);}else voice.release();}
function midiMessage(id,event){const [status,n,value]=event.data,channel=`midi:${id}:${status&15}`,source=`${channel}:${n}`;
  if((status&240)===144&&value)inputDown(n,source,value/127);
  else if((status&240)===128||((status&240)===144&&!value))inputUp(source);
  else if((status&240)===176){if(n===64&&value>=64)pedals.add(channel);else if(n===64||n===121||n===120||n===123){pedals.delete(channel);for(const v of pedalVoices.get(channel)||[])v.release();pedalVoices.delete(channel);if(n===120||n===123)for(const source of held.keys())if(source.startsWith(channel+':'))inputUp(source);}}
}
function refreshMidi(){
  for(const [id,input] of midiInputs)if(!midiAccess.inputs.has(id)||input.state==='disconnected'){input.onmidimessage=null;midiInputs.delete(id);for(const source of [...held.keys()])if(source.startsWith(`midi:${id}:`))inputUp(source);for(const channel of [...pedals])if(channel.startsWith(`midi:${id}:`)){pedals.delete(channel);for(const v of pedalVoices.get(channel)||[])v.release();pedalVoices.delete(channel);}}
  for(const input of midiAccess.inputs.values())if(input.state!=='disconnected'){input.onmidimessage=e=>midiMessage(input.id,e);midiInputs.set(input.id,input);}
  $('midiStatus').textContent=midiInputs.size?'已连接 · '+[...midiInputs.values()].map(i=>i.name||'MIDI 键盘').join(' / '):'未发现 MIDI 键盘，请检查 USB 连接后重试';
}
$('connect').onclick=safe(async()=>{if(!navigator.requestMIDIAccess)throw Error('此浏览器不支持 Web MIDI。请使用桌面 Chrome / Edge，或点击屏幕琴键练习。');try{midiAccess=await navigator.requestMIDIAccess({sysex:false});midiAccess.onstatechange=refreshMidi;refreshMidi();await audioReady();}catch(e){throw Error('MIDI 连接未完成：请允许浏览器访问 MIDI 设备，并确认 USB 连接。'+(e.name==='NotAllowedError'?' 当前访问权限被拒绝。':''));}});
function makeKeyboard(){
  const board=$('keyboard');board.replaceChildren();keys.clear();let white=0;const width=31;
  for(let n=21;n<=108;n++){const black=[1,3,6,8,10].includes(n%12),key=document.createElement('button');key.className='key'+(black?' black':'');key.style.left=(black?white*width-10:white*width)+'px';key.style.width=(black?20:width)+'px';key.dataset.midi=n;key.setAttribute('aria-label',noteName(n));if(!black){white++;if(n%12===0)key.textContent=noteName(n);}
    key.onpointerdown=e=>{e.preventDefault();key.setPointerCapture(e.pointerId);inputDown(n,'pointer:'+e.pointerId);};key.onpointerup=key.onpointercancel=key.onlostpointercapture=e=>inputUp('pointer:'+e.pointerId);board.append(key);keys.set(n,key);
  }board.style.width=white*width+'px';$('keyboardScroll').scrollLeft=keys.get(60).offsetLeft-$('keyboardScroll').clientWidth*.4;
}
function installSong(data,title){stop();song=data;rollMin=Math.min(36,...song.notes.map(n=>n.midi));rollMax=Math.max(91,...song.notes.map(n=>n.midi));lastFocus=-1;position=0;loopA=0;loopB=song.duration;$('loop').checked=false;anchors=[];anchorHistory=[];marking=false;$('addAnchor').textContent='标记当前时间的谱面位置';$('pieceTitle').textContent=title;$('pieceMeta').textContent=`${song.notes.length.toLocaleString()} 个音符 · ${song.tracks.length} 条音轨 · ${song.tempo} BPM 起始速度 · ${song.meter.numerator}/${song.meter.denominator}`;$('progress').max=song.duration;$('duration').textContent=timeLabel(song.duration);$('rollEmpty').hidden=true;makeTracks();rebuildSteps();updateLoop();updateTransport();renderPractice();renderAnchors();}
function makeTracks(){const target=$('tracks');target.replaceChildren();for(const t of song.tracks){const label=document.createElement('label'),name=document.createElement('span'),select=document.createElement('select');name.textContent=t.name;select.setAttribute('aria-label',t.name+' 声部');for(const [value,text] of [['auto','按音高分手'],['R','右手'],['L','左手'],['off','忽略']])select.add(new Option(text,value));select.value=t.hand;select.onchange=()=>{stop();t.hand=select.value;rebuildSteps();renderPractice();};label.append(name,select);target.append(label);}}
async function importMidi(file){if(!file)return;if(file.size>20*1024**2)throw Error('MIDI 文件最大 20 MB，请先裁剪。');const generation=++importGeneration;const data=parseMidi(await file.arrayBuffer());if(generation!==importGeneration)return;installSong(data,file.name.replace(/\.midi?$/i,''));$('midiName').textContent=file.name;notice('MIDI 已就绪。点击播放，或选择「等你弹对」开始练习。',true);}
async function clearSheet(){const generation=++sheetGeneration;renderGeneration++;renderTask?.cancel();renderTask=null;const oldTask=pdfTask;pdfTask=null;pdf=null;oldTask?.destroy().catch(()=>{});sheetBusy=false;anchorHistory=[];for(const p of pages)if(p.url)URL.revokeObjectURL(p.url);pages=[];anchors=[];pageIndex=0;displayedPage=-1;marking=false;$('sheetCanvasWrap').style.display='none';$('sheetEmpty').hidden=false;$('pageLabel').textContent='未添加琴谱';$('scoreName').textContent='PDF / PNG / JPG · 也可直接看音符轨道';$('sheetOverlay').replaceChildren();$('addAnchor').textContent='标记当前时间的谱面位置';updateTransport();return generation;}
async function importScore(files){
  if(!files.length)return;if(files.length>100)throw Error('一次最多添加 100 张琴谱图片。');
  if(files.some(f=>f.size>50*1024**2))throw Error('单个琴谱文件最大 50 MB。');
  if(files.reduce((s,f)=>s+f.size,0)>150*1024**2)throw Error('琴谱文件合计不能超过 150 MB。');
  const isPDF=files.length===1&&/\.pdf$/i.test(files[0].name);if(!isPDF&&files.some(f=>!/^image\/(png|jpeg|webp)$/.test(f.type)))throw Error('请选择一个 PDF，或者多张 PNG / JPG / WebP 图片。');
  const generation=await clearSheet();if(generation!==sheetGeneration)return;notice('正在本地打开琴谱…');
  try{if(isPDF){const lib=await import('./vendor/pdf.mjs');if(generation!==sheetGeneration)return;lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
      const bytes=new Uint8Array(await files[0].arrayBuffer());if(generation!==sheetGeneration)return;const task=lib.getDocument({data:bytes,isEvalSupported:false,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true});pdfTask=task;const doc=await task.promise;
      if(generation!==sheetGeneration)return;pdf=doc;pages=Array.from({length:pdf.numPages},(_,i)=>({page:i+1}));
    }else{pages=files.map(f=>({url:URL.createObjectURL(f)}));}
    $('scoreName').textContent=files.length===1?files[0].name:`${files.length} 张琴谱图片`;$('sheetEmpty').hidden=true;switchView('sheet',false);await renderPage();updateTransport();notice('琴谱已打开。播放以 MIDI 为准；可按使用指南添加谱面位置标记。',true);
  }catch(e){if(generation!==sheetGeneration)return;await clearSheet();throw Error(e.name==='PasswordException'?'请上传未加密的 PDF 琴谱。':'琴谱无法打开：'+e.message);}
}
async function renderPage(){
  if(!pages.length)return;const generation=++renderGeneration;renderTask?.cancel();renderTask=null;sheetBusy=true;const wrap=$('sheetCanvasWrap'),canvas=$('sheetCanvas');wrap.style.display='block';wrap.style.width=100*+$('zoom').value+'%';$('pageLabel').textContent=`${pageIndex+1} / ${pages.length}`;$('prevPage').disabled=pageIndex===0;$('nextPage').disabled=pageIndex===pages.length-1;
  const width=Math.max(280,$('sheetScroll').clientWidth-32)*+$('zoom').value,ratio=Math.min(2,window.devicePixelRatio||1);
  try{if(pdf){const page=await pdf.getPage(pageIndex+1);if(generation!==renderGeneration)return;const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2.5,width/base.width*ratio)});canvas.width=viewport.width;canvas.height=viewport.height;renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;}
    else {const image=new Image();image.src=pages[pageIndex].url;await image.decode();if(generation!==renderGeneration)return;const scale=Math.min(width*ratio/image.width,1,4096/Math.max(image.width,image.height));canvas.width=image.width*scale;canvas.height=image.height*scale;canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);}
    if(generation===renderGeneration){displayedPage=pageIndex;renderAnchors();}
  }catch(e){if(e.name!=='RenderingCancelledException')throw e;}finally{if(generation===renderGeneration)sheetBusy=false;}
}
function switchView(next,render=true){view=next;$('rollPanel').hidden=next!=='roll';$('sheetPanel').hidden=next!=='sheet';$('rollTab').setAttribute('aria-selected',next==='roll');$('sheetTab').setAttribute('aria-selected',next==='sheet');$('viewHint').textContent=next==='roll'?'点击或拖动轨道定位':'谱面标记支持点击定位';if(render&&next==='sheet'&&pages.length)safe(renderPage)();}
function renderAnchors(){const overlay=$('sheetOverlay');overlay.replaceChildren();for(let i=0;i<anchors.length;i++){const a=anchors[i];if(a.page!==pageIndex)continue;const dot=document.createElement('span');dot.className='anchor-dot';dot.style.left=a.x*100+'%';dot.style.top=a.y*100+'%';dot.textContent=i+1;overlay.append(dot);}const cursor=document.createElement('div');cursor.className='sheet-cursor';cursor.hidden=true;overlay.append(cursor);updateTransport();$('anchorHint').textContent=marking?`请在谱面上点击 ${timeLabel(markTime)} 对应的音符位置。再次点击标记按钮可取消。`:anchors.length?`已标记 ${anchors.length} 处 · 同行标记间会显示移动进度线；点击或拖动该行可定位。`:'PDF / 图片仅供阅读，不自动识别音符。可逐行标记起止位置，使进度线跟随琴谱。';}
function sheetPosition(t){if(!anchors.length)return null;let i=anchors.findLastIndex(a=>a.time<=t+.001);if(i<0)return null;const a=anchors[i],b=anchors[i+1];if(b&&b.page===a.page&&Math.abs(b.y-a.y)<.06&&b.x>a.x&&b.time>a.time){const f=clamp((t-a.time)/(b.time-a.time),0,1);return {...a,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};}return a;}
function sheetTime(x,y){const candidates=[];for(let i=0;i<anchors.length;i++){const a=anchors[i],b=anchors[i+1];if(a.page!==pageIndex)continue;let time=a.time,d=Math.hypot((x-a.x)*.25,y-a.y);if(b&&b.page===a.page&&Math.abs(b.y-a.y)<.06&&b.x>a.x&&x>=a.x&&x<=b.x){time=a.time+(b.time-a.time)*(x-a.x)/(b.x-a.x);d=Math.abs(y-a.y);}candidates.push({time,d});}candidates.sort((a,b)=>Math.abs(a.d-b.d)<.005?Math.abs(a.time-now())-Math.abs(b.time-now()):a.d-b.d);return candidates[0]?.d<.12?candidates[0].time:null;}
let sheetDragging=false,wasRunning=false;
$('sheetOverlay').onpointerdown=e=>{if(!song||sheetBusy)return;e.preventDefault();const r=e.currentTarget.getBoundingClientRect(),x=clamp((e.clientX-r.left)/r.width,0,1),y=clamp((e.clientY-r.top)/r.height,0,1);
  if(marking){anchorHistory.push(anchors.slice());anchors=anchors.filter(a=>Math.abs(a.time-markTime)>.01);anchors.push({time:markTime,page:pageIndex,x,y});anchors.sort((a,b)=>a.time-b.time);marking=false;$('addAnchor').textContent='标记当前时间的谱面位置';renderAnchors();return;}
  const t=sheetTime(x,y);if(t===null)return;wasRunning=playing||practicing;sheetDragging=true;e.currentTarget.setPointerCapture(e.pointerId);seek(t);};
$('sheetOverlay').onpointermove=e=>{if(!sheetDragging)return;const r=e.currentTarget.getBoundingClientRect(),t=sheetTime((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);if(t!==null)seek(t);};
$('sheetOverlay').onpointerup=$('sheetOverlay').onpointercancel=()=>{if(sheetDragging){sheetDragging=false;if(wasRunning)safe(start)();}};
$('addAnchor').onclick=()=>{if(!song||!pages.length)return;markTime=now();stop();marking=!marking;$('addAnchor').textContent=marking?'取消标记':'标记当前时间的谱面位置';renderAnchors();};
$('undoAnchor').onclick=()=>{anchors=anchorHistory.pop()||[];renderAnchors();};
function updateLoop(){$('loopRange').textContent=song?`${timeLabel(loopA)} → ${timeLabel(loopB)}`:'整首曲目';}
$('setA').onclick=()=>{const t=now();if(t>=loopB-.05){notice('循环起点必须早于终点。');return;}loopA=t;updateLoop();};
$('setB').onclick=()=>{const t=now();if(t<=loopA+.05){notice('先把进度移动到起点之后，再设置终点。');return;}loopB=t;updateLoop();};
$('loop').onchange=()=>{if(!song){$('loop').checked=false;return;}if(playing||practicing)seek(inLoop()?loopA:now(),true);};
$('play').onclick=safe(start);$('reset').onclick=()=>{seek(inLoop()?loopA:0);};
$('mode').onchange=()=>{stop();$('practicePanel').hidden=$('mode').value!=='practice';$('handLabel').hidden=$('mode').value!=='practice';rebuildSteps();renderPractice();updateTransport();};$('hand').onchange=()=>{stop();rebuildSteps();renderPractice();};
$('speed').oninput=()=>{const resume=playing,t=now();if(resume)stop();position=t;rate=+$('speed').value/100;$('speedValue').textContent=Math.round(rate*100)+'%';if(resume)beginPlayback();};
$('volume').oninput=()=>{if(master)master.gain.setTargetAtTime(+$('volume').value/100*.85,ctx.currentTime,.02);};$('monitor').onchange=()=>{releaseAll();};
let scrubbing=false,resumeScrub=false;
$('progress').onpointerdown=()=>{scrubbing=true;resumeScrub=playing||practicing;stop();};$('progress').oninput=()=>seek(+$('progress').value);const endScrub=()=>{if(scrubbing){scrubbing=false;if(resumeScrub)safe(start)();}};window.addEventListener('pointerup',endScrub);window.addEventListener('pointercancel',endScrub);
$('rollTab').onclick=()=>switchView('roll');$('sheetTab').onclick=()=>switchView('sheet');
$('prevPage').onclick=safe(async()=>{pageIndex=Math.max(0,pageIndex-1);await renderPage();});$('nextPage').onclick=safe(async()=>{pageIndex=Math.min(pages.length-1,pageIndex+1);await renderPage();});$('zoom').onchange=safe(renderPage);
$('midiFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';await importMidi(file);});$('scoreFile').onchange=safe(async e=>{const files=[...e.target.files];e.target.value='';await importScore(files);});
$('dropZone').ondragover=e=>{e.preventDefault();$('dropZone').classList.add('dragover');};$('dropZone').ondragleave=()=>{$('dropZone').classList.remove('dragover');};$('dropZone').ondrop=safe(async e=>{e.preventDefault();$('dropZone').classList.remove('dragover');const files=[...e.dataTransfer.files],midis=files.filter(f=>/\.midi?$/i.test(f.name)),scores=files.filter(f=>/\.(pdf|png|jpe?g|webp)$/i.test(f.name));if(midis.length>1)throw Error('请一次导入一个 MIDI 文件。');if(!midis.length&&!scores.length)throw Error('请拖入 MIDI、PDF 或琴谱图片。');if(midis[0])await importMidi(midis[0]);if(scores.length)await importScore(scores);});
$('clear').onclick=safe(async()=>{stop();song=null;importGeneration++;await clearSheet();position=0;steps=[];hits.clear();$('midiName').textContent='.mid / .midi · 保留原曲节奏与力度';$('pieceTitle').textContent='你的下一首，会是什么？';$('pieceMeta').textContent='导入 MIDI 后，音符会在这里展开。';$('duration').textContent='0:00';$('progress').value=0;$('tracks').replaceChildren();$('loop').checked=false;$('loopRange').textContent='整首曲目';$('rollEmpty').hidden=false;renderPractice();updateTransport();notice('文件已从当前练习室清空。',true);});
$('demo').onclick=()=>{importGeneration++;const melody=[60,64,67,72,71,67,64,62,60,65,69,72,74,69,65,62,60,64,67,72,76,74,71,67,69,65,62,67,64,62,60,60];const notes=melody.map((midi,i)=>({time:i*.4,end:i*.4+.34,keyEnd:i*.4+.34,midi,velocity:.7+(i%4===0?.1:0),track:0}));for(let i=0;i<8;i++)for(const [j,midi] of [48,55,60].entries())notes.push({time:i*1.6+j*.4,end:i*1.6+j*.4+.72,keyEnd:i*1.6+j*.4+.4,midi:midi-(i%4===1?5:0),velocity:.5,track:1});notes.sort((a,b)=>a.time-b.time||a.midi-b.midi);installSong({notes,duration:13,tracks:[{id:0,name:'练习旋律',hand:'R'},{id:1,name:'分解和弦',hand:'L'}],tempo:150,meter:{numerator:4,denominator:4}},'晨间小练习');$('midiName').textContent='内置原创练习片段 · 32 个旋律音';switchView('roll');notice('已载入原创练习片段。试试慢速播放，或切换「等你弹对」。',true);};
$('helpButton').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();$('help').onclick=e=>{if(e.target===$('help')){const r=$('help').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('help').close();}};
const keyMap={a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12};
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||$('help').open||e.ctrlKey||e.altKey||e.metaKey)return;const key=e.key.toLowerCase();if(e.code==='Space'){e.preventDefault();if(!e.repeat)safe(start)();}else if(key==='z'||key==='x'){if(!e.repeat){octave=clamp(octave+(key==='z'?-1:1),1,7);$('octaveLabel').textContent='C'+octave;}}else if(key in keyMap&&!e.repeat){e.preventDefault();inputDown((octave+1)*12+keyMap[key],'computer:'+key);}});
window.addEventListener('keyup',e=>inputUp('computer:'+e.key.toLowerCase()));window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',()=>{if(document.hidden&&(playing||practicing)){stop();notice('切换到后台时已暂停，回到页面后可继续。',true);}});
let rollDrag=false,rollResume=false;
function rollSeek(e){const r=$('roll').getBoundingClientRect();seek(rollWindow.start+clamp((e.clientX-r.left-38)/(r.width-50),0,1)*rollWindow.span);}
$('roll').onpointerdown=e=>{if(!song)return;e.preventDefault();rollResume=playing||practicing;rollDrag=true;e.currentTarget.setPointerCapture(e.pointerId);rollSeek(e);};$('roll').onpointermove=e=>{if(rollDrag)rollSeek(e);};$('roll').onpointerup=$('roll').onpointercancel=()=>{if(rollDrag){rollDrag=false;if(rollResume)safe(start)();}};
function drawRoll(t){const canvas=$('roll'),w=canvas.clientWidth,h=canvas.clientHeight;if(!w)return;const dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=w*dpr;canvas.height=h*dpr;}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);const min=rollMin,max=rollMax,row=(h-26)/(max-min+1),span=10;if(!rollDrag)rollWindow={start:Math.max(0,t-2),span};const start=rollWindow.start,left=38,width=w-50;c.font='9px system-ui';
  for(let n=min;n<=max;n++){const y=(max-n)*row;if([1,3,6,8,10].includes(n%12)){c.fillStyle='#ecefe64d';c.fillRect(left,y,width,row);}if(n%12===0){c.strokeStyle='#e1e5da';c.beginPath();c.moveTo(left,y);c.lineTo(w,y);c.stroke();c.fillStyle='#9ba494';c.fillText(noteName(n),7,y+row+2);}}
  for(let sec=Math.ceil(start);sec<=start+span;sec++){const x=left+(sec-start)/span*width;c.strokeStyle='#e8ebe2';c.beginPath();c.moveTo(x,0);c.lineTo(x,h-24);c.stroke();c.fillStyle='#8f9988';c.fillText(timeLabel(sec),x+3,h-8);}
  if(song)for(const n of song.notes){if(n.time>start+span)break;if(n.end<start||hand(n)==='off')continue;const x=left+(Math.max(n.time,start)-start)/span*width,end=left+(Math.min(n.keyEnd??n.end,start+span)-start)/span*width,y=(max-clamp(n.midi,min,max))*row;c.fillStyle=hand(n)==='L'?'#6a9988':'#dc9669';c.globalAlpha=n.time<=t&&n.end>t?1:.72;c.fillRect(x,y+.5,Math.max(2,end-x),Math.max(2,row-1));if(n.end>(n.keyEnd??n.end)){c.globalAlpha=.18;c.fillRect(Math.max(x,end),y+.5,Math.max(0,(Math.min(n.end,start+span)-(n.keyEnd??n.end))/span*width),Math.max(2,row-1));}}c.globalAlpha=1;
  if(song){const x=left+(t-start)/span*width;c.strokeStyle='#365e51';c.lineWidth=1.5;c.beginPath();c.moveTo(x,0);c.lineTo(x,h-23);c.stroke();c.fillStyle='#365e51';c.beginPath();c.moveTo(x-4,0);c.lineTo(x+4,0);c.lineTo(x,6);c.fill();}c.lineWidth=1;
}
function frame(){
  let t=now();if(playing&&t>=(inLoop()?loopB:song.duration)){const looping=inLoop();stop();position=looping?loopA:song.duration;if(looping)beginPlayback();t=position;}
  $('elapsed').textContent=timeLabel(t);if(!scrubbing)$('progress').value=t;
  if(view==='roll')drawRoll(t);
  for(const key of keys.values())key.className='key'+([1,3,6,8,10].includes(+key.dataset.midi%12)?' black':'');
  let current=[];if(practicing&&steps[stepIndex]){current=steps[stepIndex].notes;for(const n of current)keys.get(n)?.classList.add('expected-'+(n<60?'L':'R'));}
  else if(song&&playing){for(const n of song.notes){if(n.time>t)break;if(n.end>t&&hand(n)!=='off'){current.push(n.midi);keys.get(n.midi)?.classList.add('active-'+hand(n));}}}
  if(current.length&&(playing||practicing)&&current[0]!==lastFocus){lastFocus=current[0];const key=keys.get(lastFocus),scroll=$('keyboardScroll');if(key&&(key.offsetLeft<scroll.scrollLeft+20||key.offsetLeft>scroll.scrollLeft+scroll.clientWidth-35))scroll.scrollLeft=Math.max(0,key.offsetLeft-scroll.clientWidth*.4);}
  for(const n of held.values())keys.get(n)?.classList.add('held');if(performance.now()<wrongUntil)keys.get(wrongNote)?.classList.add('wrong');$('notesNow').textContent=current.length?[...new Set(current)].map(noteName).join(' · '):song?'准备好了，慢慢来':'等待音乐';
  if(view==='sheet'&&anchors.length&&!marking){const point=sheetPosition(t),cursor=$('sheetOverlay').querySelector('.sheet-cursor');if(point&&$('follow').checked&&(playing||practicing)&&point.page!==pageIndex&&!sheetDragging&&!sheetBusy){pageIndex=point.page;safe(renderPage)();}
    if(cursor){cursor.hidden=!point||point.page!==displayedPage;if(!cursor.hidden){cursor.style.left=point.x*100+'%';cursor.style.top=point.y*100+'%';if($('follow').checked&&(playing||practicing)&&!sheetDragging){const scroll=$('sheetScroll'),y=point.y*$('sheetCanvasWrap').clientHeight;if(y<scroll.scrollTop+35||y>scroll.scrollTop+scroll.clientHeight-50)scroll.scrollTop=Math.max(0,y-scroll.clientHeight*.35);}}}}
  requestAnimationFrame(frame);
}
makeKeyboard();updateTransport();renderPractice();requestAnimationFrame(frame);
