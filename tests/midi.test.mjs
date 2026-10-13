import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMidi,practiceGroups} from '../midi.mjs';
export const vlq=n=>{const a=[n&127];while(n>>=7)a.unshift((n&127)|128);return a;};
const u32=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255];
export function midiFile(tracks,division=480,format=1){const result=[...Buffer.from('MThd'),0,0,0,6,0,format,0,tracks.length,division>>8,division&255];for(const events of tracks){const bytes=[...events.flat(),0,255,47,0];result.push(...Buffer.from('MTrk'),...u32(bytes.length),...bytes);}return new Uint8Array(result).buffer;}
test('tempo changes and pedal sustain use the original musical timeline',()=>{
  const midi=parseMidi(midiFile([
    [[0,255,81,3,7,161,32],[...vlq(480),255,81,3,15,66,64]],
    [[0,144,60,100],[...vlq(240),176,64,127],[...vlq(240),128,60,0],[...vlq(480),176,64,0]]
  ]));assert.equal(midi.notes.length,1);assert.equal(midi.notes[0].keyEnd,.5);assert.equal(midi.notes[0].end,1.5);assert.equal(midi.duration,1.5);
});
test('running status, velocity-zero note-off and repeated pitches stay distinct',()=>{
  const midi=parseMidi(midiFile([[[0,144,60,100],[...vlq(120),60,0],[0,60,80],[...vlq(120),60,0]]],480,0));
  assert.equal(midi.notes.length,2);assert.equal(midi.notes[0].end,.125);assert.equal(midi.notes[1].time,.125);assert.equal(midi.notes[1].end,.25);
});
test('multi-track chords group once and honor chosen hand and muted tracks',()=>{
  const midi=parseMidi(midiFile([[[0,144,48,80],[...vlq(480),128,48,0]],[[0,145,64,90],[0,145,67,90],[...vlq(480),129,64,0],[0,129,67,0]]]));
  assert.deepEqual(practiceGroups(midi.notes,midi.tracks,'both')[0].notes,[48,64,67]);assert.deepEqual(practiceGroups(midi.notes,midi.tracks,'L')[0].notes,[48]);midi.tracks[1].hand='off';assert.deepEqual(practiceGroups(midi.notes,midi.tracks)[0].notes,[48]);
});
test('SMPTE timing works independently of tempo',()=>{
  const midi=parseMidi(midiFile([[[0,144,60,90],[...vlq(1000),128,60,0]]],(231<<8)|40,0));assert.equal(midi.duration,1);
});
test('missing note-off ends safely at the end of its track',()=>{
  const midi=parseMidi(midiFile([[[0,144,60,90],[...vlq(480),176,1,0]]]));assert.equal(midi.notes[0].end,.5);
});
test('malformed input, empty files and asynchronous type 2 fail clearly',()=>{
  assert.throws(()=>parseMidi(new ArrayBuffer(0)),/损坏/);assert.throws(()=>parseMidi(midiFile([[]])),/没有/);assert.throws(()=>parseMidi(midiFile([[]],480,2)),/Type 2/);
  const good=new Uint8Array(midiFile([[[0,144,60,90],[...vlq(480),128,60,0]]]));assert.throws(()=>parseMidi(good.slice(0,-3).buffer),/损坏/);
});
