import {mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('out/stills',{recursive:true});
for(const frame of [60,200,360,500,660,816]) {
  const result=spawnSync(process.execPath,['node_modules/@remotion/cli/remotion-cli.js','still','src/index.tsx','DecisionLoop',`out/stills/${frame}.png`,`--frame=${frame}`,'--public-dir=public'],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}
console.log('Check each still for clipping and text legibility. Audio: 258–300 typing; 618 click.');
