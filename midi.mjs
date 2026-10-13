// Standard MIDI files are parsed locally. No user data leaves the browser.
export function parseMidi(buffer) {
  const a = new Uint8Array(buffer), v = new DataView(a.buffer, a.byteOffset, a.byteLength);
  let p = 0, limit = a.length;
  function need(n) { if (p + n > limit) throw Error('MIDI 文件不完整或已损坏。'); }
  function u8() { need(1); return a[p++]; }
  function u16() { need(2); const n=v.getUint16(p); p+=2; return n; }
  function u32() { need(4); const n=v.getUint32(p); p+=4; return n; }
  function tag() { need(4); return String.fromCharCode(...a.subarray(p,p+=4)); }
  function vlq() { let n=0; for(let i=0;i<4;i++){const b=u8();n=n*128+(b&127);if(!(b&128))return n;}throw Error('MIDI 可变长度字段无效。'); }
  if (tag() !== 'MThd') throw Error('请选择有效的 .mid 或 .midi 文件。');
  const header=u32(); if(header<6)throw Error('MIDI 文件头无效。'); need(header);
  const format=u16(), count=u16(), division=u16(); p+=header-6;
  if(format>1)throw Error('暂不支持 Type 2 MIDI，请导出为 Type 0 或 Type 1。');
  if(!count||!division||count>512)throw Error('MIDI 音轨或时间精度无效。');
  const events=[], tracks=[], tempos=[{tick:0,us:500000}], meters=[]; let totalTicks=0;
  for(let track=0;track<count;track++) {
    limit=a.length; if(tag()!=='MTrk')throw Error('找不到 MIDI 音轨。');const length=u32();need(length);limit=p+length;
    let tick=0,running=0;const info={id:track,name:`音轨 ${track+1}`,endTick:0};tracks.push(info);
    while(p<limit) {
      tick+=vlq(); if(!Number.isSafeInteger(tick))throw Error('MIDI 时长无效。');
      let status=u8();if(status<128){if(!running)throw Error('MIDI 连续事件无效。');p--;status=running;}
      else if(status<240)running=status;
      if(status===255){running=0;const type=u8(),size=vlq();need(size);const data=a.subarray(p,p+size);p+=size;
        if(type===3) info.name=new TextDecoder().decode(data).replace(/[\x00-\x1f]/g,'').slice(0,100)||info.name;
        if(type===81&&size===3){const us=data[0]*65536+data[1]*256+data[2];if(us)tempos.push({tick,us});}
        if(type===88&&size>=2&&data[0]&&data[1]<8)meters.push({tick,numerator:data[0],denominator:2**data[1]});
        if(type===47){p=limit;break;}
      } else if(status===240||status===247){running=0;const size=vlq();need(size);p+=size;}
      else {const type=status>>4,channel=status&15;if(type<8||type>14)throw Error('MIDI 事件不受支持。');const n=u8(),value=(type===12||type===13)?0:u8();if(n>127||value>127)throw Error('MIDI 数据字段无效。');
        if(type===8||type===9||type===11)events.push({tick,track,channel,type,n,value,order:events.length});
        if(events.length>1000000)throw Error('MIDI 事件过多，请使用较短的片段。');
      }
    }
    info.endTick=tick;totalTicks=Math.max(totalTicks,tick);
  }
  let tickSeconds;
  if(division&32768){const fps=256-(division>>8),sub=division&255;if(![24,25,29,30].includes(fps)||!sub)throw Error('SMPTE 时间格式无效。');tickSeconds=t=>t/((fps===29?29.97:fps)*sub);}
  else {
    tempos.sort((a,b)=>a.tick-b.tick);let tick=0,seconds=0,us=500000;const segments=[];
    for(const t of tempos){seconds+=(t.tick-tick)*us/1e6/division;tick=t.tick;us=t.us;if(segments.at(-1)?.tick===tick)segments.pop();segments.push({tick,seconds,us});}
    tickSeconds=t=>{let lo=0,hi=segments.length;while(lo+1<hi){const m=(lo+hi)>>1;if(segments[m].tick<=t)lo=m;else hi=m;}const s=segments[lo];return s.seconds+(t-s.tick)*s.us/1e6/division;};
  }
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order);
  const active=new Map(),pedal=new Map(),released=new Map(),notes=[];
  function finish(note,tick){note.end=tickSeconds(Math.max(tick,note.tick+1));}
  function release(e,all=false){for(const [key,queue] of active){if(queue[0]?.channel!==e.channel||(!all&&(queue[0].track!==e.track||queue[0].midi!==e.n)))continue;
      const chosen=all?queue.splice(0):[queue.shift()];for(const note of chosen){note.keyEnd=tickSeconds(e.tick);if(pedal.get(e.channel)&&!all){if(!released.has(e.channel))released.set(e.channel,[]);released.get(e.channel).push(note);}else finish(note,e.tick);}if(!queue.length)active.delete(key);if(!all)break;}}
  for(const e of events){
    if(e.type===9&&e.value){if(e.channel===9)continue;const key=`${e.track}:${e.channel}:${e.n}`,note={tick:e.tick,time:tickSeconds(e.tick),midi:e.n,velocity:e.value/127,track:e.track,channel:e.channel};notes.push(note);if(!active.has(key))active.set(key,[]);active.get(key).push(note);}
    else if(e.type===8||(e.type===9&&!e.value))release(e);
    else if(e.type===11&&(e.n===64||e.n===120||e.n===123||e.n===121)){
      const down=e.n===64&&e.value>=64;pedal.set(e.channel,down);
      if(!down){for(const note of released.get(e.channel)||[])finish(note,e.tick);released.delete(e.channel);}
      if(e.n===120||e.n===123)release(e,true);
    }
  }
  for(const queue of active.values())for(const note of queue){note.keyEnd=tickSeconds(Math.max(note.tick+1,tracks[note.track].endTick));finish(note,Math.max(note.tick+1,tracks[note.track].endTick));}
  for(const queue of released.values())for(const note of queue)finish(note,totalTicks);
  if(!notes.length)throw Error('这个 MIDI 没有可演奏的音符（打击乐通道不计入钢琴）。');
  if(notes.length>100000)throw Error('音符超过 100,000 个，请先裁剪 MIDI。');
  notes.sort((a,b)=>a.time-b.time||a.midi-b.midi);
  const used=tracks.filter(t=>notes.some(n=>n.track===t.id));
  for(const t of used){const ns=notes.filter(n=>n.track===t.id);t.count=ns.length;t.average=ns.reduce((s,n)=>s+n.midi,0)/ns.length;t.hand=used.length===1?'auto':(t.average<60?'L':'R');}
  const duration=Math.max(...notes.map(n=>n.end));
  if(!Number.isFinite(duration)||duration>14400)throw Error('MIDI 时长超过 4 小时，请使用较短的文件。');
  return {notes,tracks:used,duration,format,tempo:Math.round(6e7/(tempos.findLast(t=>t.tick===0)?.us||500000)),meter:meters.find(t=>t.tick===0)||{numerator:4,denominator:4}};
}
export function handFor(note,tracks){const hand=tracks.find(t=>t.id===note.track)?.hand;return hand==='auto'?(note.midi<60?'L':'R'):hand;}
export function practiceGroups(notes,tracks,hand='both') {
  const steps=[];
  for(const n of notes){const h=handFor(n,tracks);if(h==='off'||(hand!=='both'&&h!==hand))continue;
    let step=steps.at(-1);if(!step||n.time-step.time>.035){step={time:n.time,notes:[]};steps.push(step);}if(!step.notes.includes(n.midi))step.notes.push(n.midi);
  }
  return steps;
}
