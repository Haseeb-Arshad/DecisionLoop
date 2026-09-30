// Portable Windows/Unix equivalent of the launch-video skill's sound generator.
// Deterministic local synthesis; no downloaded audio or paid provider.
import {writeFileSync, mkdirSync} from 'node:fs';
mkdirSync('public',{recursive:true});
let seed=7;
const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function wav(name,duration,times) {
  const rate=44100,n=Math.round(duration*rate),data=new Float64Array(n);
  for(const start of times) for(let i=0;i<1323;i++) {
    const index=Math.round(start*rate)+i;
    if(index>=n)break;
    const envelope=Math.sin(Math.PI*i/1323)*Math.exp(-i/400);
    data[index]+=(random()*2-1)*envelope*.35;
  }
  const output=Buffer.alloc(44+n*2);
  output.write('RIFF',0);output.writeUInt32LE(36+n*2,4);output.write('WAVEfmt ',8);
  output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);
  output.writeUInt32LE(rate,24);output.writeUInt32LE(rate*2,28);output.writeUInt16LE(2,32);output.writeUInt16LE(16,34);
  output.write('data',36);output.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++)output.writeInt16LE(Math.round(Math.max(-1,Math.min(1,data[i]))*32767),44+i*2);
  writeFileSync(`public/${name}.wav`,output);
}
const times=[];for(let t=0;t<1.75;t+=.06+random()*.07)times.push(t);
wav('sfx-typing',1.75,times);wav('sfx-click',.22,[0,.06]);
console.log('Synthesized typing (frames 258–300) and click (frame 618) audio.');
