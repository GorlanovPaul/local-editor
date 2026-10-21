import {PNG} from 'pngjs';import fs from 'fs';
function icon(n,mask){const p=new PNG({width:n,height:n});const pad=mask?0:n*0.08,r=mask?0:n*0.2;
for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(y*n+x)*4;let inside=x>=pad&&y>=pad&&x<n-pad&&y<n-pad;
if(inside&&r){const cx=Math.min(Math.max(x,pad+r),n-pad-r),cy=Math.min(Math.max(y,pad+r),n-pad-r);inside=(x-cx)**2+(y-cy)**2<=r*r}
if(!inside){p.data[i+3]=0;continue}
const t=(x+y)/(2*n);let R=40+t*60,G=90+t*40,B=230-t*40;
const u=x/n,v=y/n; // mountain + sun
if((u-0.64)**2+(v-0.36)**2<0.006){R=255;G=210;B=70}
else if(v>0.72-0.5*Math.max(0,0.3-Math.abs(u-0.38))*1.6&&v<0.74&&u>0.2&&u<0.8||(v>0.5+Math.abs(u-0.38)*1.0&&v<0.74&&u>0.2&&u<0.8)){R=G=B=250}
p.data[i]=R;p.data[i+1]=G;p.data[i+2]=B;p.data[i+3]=255}
fs.writeFileSync(`public/${mask?'maskable-':'icon-'}${n}.png`,PNG.sync.write(p))}
icon(192);icon(512);icon(192,1);icon(512,1);
