import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {BrowserWindow} from './scenes/BrowserWindow';

const ink = '#213d33', green = '#176b58', muted = '#677c73', line = '#d6e2db', alert = '#b65331';
const clamp = {extrapolateLeft:'clamp', extrapolateRight:'clamp'} as const;
const mono = 'Consolas, monospace';
let offset=0;
const at=(duration:number)=>{const from=offset;offset+=duration;return {from,durationInFrames:duration};};
const beats={intro:at(96),record:at(144),context:at(144),evidence:at(144),review:at(192),outro:at(144)};
const reveal = (frame:number, from=0) => ({opacity:interpolate(frame,[from,from+4],[0,1],clamp), transform:`translateY(${interpolate(frame,[from,from+12],[14,0],clamp)}px)`});

function Logo({large=false}:{large?:boolean}) {
  return <div style={{display:'flex',alignItems:'center',gap:large?28:16,fontSize:large?56:30,fontWeight:650,letterSpacing:-1}}>
    <div style={{width:large?88:48,height:large?88:48,borderRadius:large?24:13,background:green,display:'grid',placeItems:'center',color:'white',fontSize:large?64:34}}>↗</div>DecisionLoop
  </div>;
}
function Frame({children,stage}:{children:React.ReactNode;stage:string}) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background:'#f3f6f4',color:ink,fontFamily:'Segoe UI, Arial, sans-serif',padding:80,...reveal(frame)}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><Logo/><span style={{color:muted,fontSize:23}}>{stage}</span></div>
    {children}
    <div style={{position:'absolute',bottom:38,left:80,right:80,display:'flex',justifyContent:'space-between',fontSize:19,color:muted}}><span>Decision memory for people and coding agents</span><span>Illustrative workflow · local demonstration data</span></div>
  </AbsoluteFill>;
}
function Label({children}:{children:React.ReactNode}) {return <div style={{fontSize:22,color:muted,marginBottom:12}}>{children}</div>;}
function Title({children}:{children:React.ReactNode}) {return <h1 style={{fontSize:74,lineHeight:1.08,letterSpacing:-3,fontWeight:600,margin:'0 0 28px',whiteSpace:'pre-line'}}>{children}</h1>;}
function Brand({outro=false}:{outro?:boolean}) {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{background:'#f3f6f4',color:ink,fontFamily:'Segoe UI, Arial, sans-serif',padding:'150px 150px',...reveal(f)}}>
    <Logo large/>
    <h1 style={{fontSize:108,fontWeight:600,letterSpacing:-5,lineHeight:1.05,margin:'88px 0 35px',maxWidth:1550}}>{outro?'Give agents context.':'Agents change.'}<br/>{outro?'Keep decisions accountable.':'Decisions persist.'}</h1>
    <div style={{fontSize:32,color:muted}}>{outro?'github.com/Haseeb-Arshad/DecisionLoop':'Preserve the choice, the tradeoff, and what would change your mind.'}</div>
    {outro&&<div style={{fontSize:23,color:green,marginTop:45,...reveal(f,28)}}>Open source · local-first · 2.0 alpha</div>}
  </AbsoluteFill>;
}
function Record() {
  const f=useCurrentFrame();
  return <Frame stage="Record the tradeoff">
    <div style={{display:'grid',gridTemplateColumns:'620px 1fr',gap:90,marginTop:95,alignItems:'center'}}>
      <div><Title>{'Keep the reason\nwith the choice.'}</Title><p style={{fontSize:30,lineHeight:1.5,color:muted,maxWidth:580}}>The next session should inherit the decision, not repeat the debate.</p></div>
      <div style={{background:'white',border:`1px solid ${line}`,borderRadius:22,padding:50,...reveal(f,8)}}>
        <Label>Authentication / decision record</Label><h2 style={{fontSize:43,margin:'0 0 35px',letterSpacing:-1}}>Use Redis-backed sessions</h2>
        <div style={{borderBottom:`1px solid ${line}`,paddingBottom:25}}><Label>Why we chose it</Label><div style={{fontSize:29,lineHeight:1.45}}>Customers need immediate session revocation.</div></div>
        <div style={{marginTop:25,...reveal(f,38)}}><Label>Rejected alternative</Label><div style={{fontSize:29}}>Stateless JWTs</div><div style={{fontSize:25,color:muted,marginTop:10}}>Revocation would require additional controls.</div></div>
        <div style={{marginTop:35,padding:25,background:'#eaf3ee',borderRadius:12,...reveal(f,65)}}><Label>Condition to watch</Label><div style={{fontSize:28,color:green,fontWeight:600}}>Redis p95 lookup latency stays below 20 ms.</div></div>
      </div>
    </div>
  </Frame>;
}
const prompt='Refactor src/auth/session.ts';
function AgentContext() {
  const f=useCurrentFrame();
  const typed=prompt.slice(0,Math.floor(interpolate(f,[18,60],[0,prompt.length],clamp)));
  return <Frame stage="Retrieve before editing">
    <div style={{marginTop:74}}><Title>New agent. Same understanding.</Title><p style={{fontSize:28,color:muted,marginTop:0}}>Retrieve the reasoning that governs the files you are about to change.</p></div>
    <div style={{display:'grid',gridTemplateColumns:'670px 1fr',gap:36,marginTop:40}}>
      <div style={{background:'#e7eee9',padding:35,borderRadius:18,minHeight:345}}><Label>Human request / new session</Label><div style={{fontSize:28,fontFamily:mono,lineHeight:1.65,minHeight:105}}>{typed}<span style={{color:green}}>▌</span></div><div style={{marginTop:28,borderTop:`1px solid ${line}`,paddingTop:25,...reveal(f,70)}}><Label>Agent tool call</Label><div style={{fontFamily:mono,fontSize:25}}>decisionloop_get_context</div><div style={{fontSize:23,color:muted,marginTop:15}}>Resource: src/auth/session.ts</div></div></div>
      <div style={{background:'white',border:`1px solid ${line}`,borderRadius:18,padding:38,...reveal(f,80)}}><Label>Relevant decision context / illustrative output</Label><h2 style={{fontSize:35,margin:'0 0 24px'}}>Use Redis-backed sessions</h2><div style={{fontSize:26,lineHeight:1.7}}>Keep immediate revocation.<br/>JWTs were rejected for this requirement.<br/>Watch p95 lookup latency &lt; 20 ms.</div><div style={{fontSize:23,color:green,borderTop:`1px solid ${line}`,marginTop:25,paddingTop:23}}>Matched by governed resource: src/auth/**</div></div>
    </div>
  </Frame>;
}
function Evidence() {
  const f=useCurrentFrame();
  const value=interpolate(f,[40,76],[12,35],clamp);
  return <Frame stage="Check what changed">
    <div style={{display:'grid',gridTemplateColumns:'650px 1fr',gap:80,marginTop:110,alignItems:'center'}}>
      <div><Title>{'An old assumption.\nA new observation.'}</Title><p style={{fontSize:29,lineHeight:1.5,color:muted}}>Measured facts check typed conditions. The evidence stays attached to the warning.</p><div style={{fontSize:25,fontFamily:mono,color:green,marginTop:35}}>infrastructure:redis<br/>p95_latency_ms</div></div>
      <div style={{background:'white',border:`1px solid ${line}`,borderRadius:22,padding:50}}>
        <Label>Representative load test / synthetic example</Label><div style={{fontSize:108,fontWeight:600,color:value>=20?alert:green,letterSpacing:-4}}>{Math.round(value)}<span style={{fontSize:36,letterSpacing:0}}> ms</span></div>
        <div style={{width:720,height:170,position:'relative',marginTop:20,borderBottom:`1px solid ${line}`}}>
          <div style={{position:'absolute',width:interpolate(value,[0,40],[0,720]),height:52,top:60,background:value>=20?'#d07955':green,borderRadius:7}}/>
          <div style={{position:'absolute',left:360,top:12,bottom:5,borderLeft:`3px dashed ${alert}`}}/>
          <div style={{position:'absolute',left:290,top:0,fontSize:22,color:alert,background:'white',padding:'0 10px'}}>20 ms limit</div>
          <div style={{position:'absolute',bottom:-38,left:0,color:muted,fontSize:21}}>0</div><div style={{position:'absolute',bottom:-38,right:0,color:muted,fontSize:21}}>40 ms</div>
        </div>
        <div style={{marginTop:75,fontSize:28,color:alert,fontWeight:600,...reveal(f,88)}}>Condition contradicted → decision at risk</div><div style={{marginTop:14,fontSize:24,color:muted,...reveal(f,88)}}>Checked deterministically. No model needed.</div>
      </div>
    </div>
  </Frame>;
}
function Review() {
  const f=useCurrentFrame();
  const opened=f>=90;
  const cursorX=interpolate(f,[62,90],[1120,1540],clamp), cursorY=interpolate(f,[62,90],[780,660],clamp);
  return <Frame stage="Keep the decision human">
    <div style={{marginTop:55}}><Title>Changed evidence deserves a human review.</Title><p style={{fontSize:28,color:muted,marginTop:0}}>A person sees the evidence and chooses what happens next.</p></div>
    <div style={{position:'absolute',left:80,top:360}}><BrowserWindow w={1160} h={575} chrome="none"><Img src={staticFile('workspace.png')} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'top'}}/></BrowserWindow></div>
    <div style={{position:'absolute',right:80,top:385,width:455,background:'white',border:`1px solid ${line}`,borderRadius:18,padding:35,...reveal(f,22)}}><Label>Decision flagged</Label><h2 style={{fontSize:34,lineHeight:1.25,margin:'0 0 22px'}}>Redis session cache</h2><div style={{fontSize:26,lineHeight:1.5,color:alert}}>35 ms observed.<br/>20 ms expected.</div>
      <div style={{marginTop:24,padding:20,background:opened?'#eaf3ee':green,color:opened?green:'white',borderRadius:10,fontSize:26,fontWeight:600}}>{opened?'Evidence opened for review':'Review evidence'}</div>
      {opened?<div style={{fontSize:24,lineHeight:1.5,color:muted,marginTop:24,...reveal(f,90)}}>Accept or dismiss the conflict. Reopen the choice when it needs reconsideration.</div>:<div style={{fontSize:24,lineHeight:1.5,color:muted,marginTop:24}}>History and rationale remain traceable.</div>}
    </div>
    {f>=62&&f<112&&<svg width="45" height="55" viewBox="0 0 24 30" style={{position:'absolute',left:cursorX,top:cursorY,transform:f>=90&&f<94?'scale(.82)':'scale(1)',filter:'drop-shadow(0 2px 3px #99aaa0)'}}><path d="M2 2 L2 24 L8 18 L13 28 L17 26 L12 16 L21 16 Z" fill={ink} stroke="white" strokeWidth="1.5"/></svg>}
  </Frame>;
}
export function DecisionLoopFilm() {
  return <AbsoluteFill>
    <Sequence {...beats.intro}><Brand/></Sequence>
    <Sequence {...beats.record}><Record/></Sequence>
    <Sequence {...beats.context}><AgentContext/></Sequence>
    <Sequence {...beats.evidence}><Evidence/></Sequence>
    <Sequence {...beats.review}><Review/></Sequence>
    <Sequence {...beats.outro}><Brand outro/></Sequence>
    <Sequence from={beats.context.from+18} durationInFrames={42}><Audio src={staticFile('sfx-typing.wav')} volume={0.22}/></Sequence>
    <Sequence from={beats.review.from+90} durationInFrames={6}><Audio src={staticFile('sfx-click.wav')} volume={0.3}/></Sequence>
  </AbsoluteFill>;
}
