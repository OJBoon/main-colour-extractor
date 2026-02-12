(function(global){
  function toHex(c){ return c.toString(16).padStart(2,'0'); }
  function rgbToHex(r,g,b){ return `#${toHex(r)}${toHex(g)}${toHex(b)}`; }
  function clamp(v){ return Math.max(0, Math.min(255, v)); }
  function srgbToLinear(c){ const v=c/255; return v<=0.04045? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
  function linearToSrgb(v){ return v<=0.0031308? 12.92*v : 1.055*Math.pow(v,1/2.4)-0.055; }
  function luminance(r,g,b){ const R=srgbToLinear(r), G=srgbToLinear(g), B=srgbToLinear(b); return 0.2126*R+0.7152*G+0.0722*B; }
  function rgbToHsv(r,g,b){ const rr=r/255, gg=g/255, bb=b/255; const max=Math.max(rr,gg,bb), min=Math.min(rr,gg,bb); const d=max-min; let h=0; if(d!==0){ switch(max){ case rr: h=((gg-bb)/d)%6; break; case gg: h=(bb-rr)/d+2; break; case bb: h=(rr-gg)/d+4; break; } h*=60; if(h<0) h+=360; } const s=max===0?0:d/max; const v=max; return {h,s,v}; }
  function isNearBlackWhite(r,g,b){ const {s,v}=rgbToHsv(r,g,b); if(v<0.08) return true; if(v>0.92 && s<0.08) return true; return false; }
  function isIgnorableColor(r,g,b){ const {s,v}=rgbToHsv(r,g,b); if(v<0.05) return true; if(v>0.90 && s<0.1) return true; return false; }
  function hsvDist(a,b){ const d=Math.abs(a-b); return Math.min(d, 360-d); }
  function rgbToLab(r,g,b){
    const R=srgbToLinear(r), G=srgbToLinear(g), B=srgbToLinear(b);
    const X=(0.4124*R+0.3576*G+0.1805*B)*100;
    const Y=(0.2126*R+0.7152*G+0.0722*B)*100;
    const Z=(0.0193*R+0.1192*G+0.9505*B)*100;
    const Xn=95.047, Yn=100.0, Zn=108.883;
    const fx=fXYZ(X/Xn), fy=fXYZ(Y/Yn), fz=fXYZ(Z/Zn);
    return { L:116*fy-16, a:500*(fx-fy), b:200*(fy-fz) };
    function fXYZ(t){ return t>0.008856? Math.cbrt(t) : (7.787*t+16/116); }
  }
  function labToRgb(L,a,b){
    const Yn=100.0, Xn=95.047, Zn=108.883;
    const fy=(L+16)/116, fx=a/500+fy, fz=fy-b/200;
    const xr=invf(fx), yr=invf(fy), zr=invf(fz);
    const X=xr*Xn, Y=yr*Yn, Z=zr*Zn;
    let Rlin=X/100*3.2406 + Y/100*-1.5372 + Z/100*-0.4986;
    let Glin=X/100*-0.9689 + Y/100*1.8758 + Z/100*0.0415;
    let Blin=X/100*0.0557 + Y/100*-0.2040 + Z/100*1.0570;
    const R=clamp(Math.round(linearToSrgb(Rlin)*255));
    const G=clamp(Math.round(linearToSrgb(Glin)*255));
    const B=clamp(Math.round(linearToSrgb(Blin)*255));
    return { r:R, g:G, b:B };
    function invf(t){ const t3=t*t*t; return t3>0.008856? t3 : (t-16/116)/7.787; }
  }
  function estimateBorderMargins(w,h,data){
    const stripX=Math.max(1, Math.floor(w*0.05));
    const stripY=Math.max(1, Math.floor(h*0.05));
    function stripMetrics(x0,y0,x1,y1){
      let n=0, sSum=0, nearBW=0;
      for(let y=y0;y<y1;y++){
        for(let x=x0;x<x1;x++){
          const idx=(y*w+x)*4; const r=data[idx], g=data[idx+1], b=data[idx+2], a=data[idx+3];
          if(a<128) continue; const hsv=rgbToHsv(r,g,b); sSum+=hsv.s; if(isIgnorableColor(r,g,b)) nearBW++; n++;
        }
      }
      const sAvg=n? sSum/n : 0; const bwRatio=n? nearBW/n : 1; return { sAvg, bwRatio };
    }
    const top=stripMetrics(0,0,w,stripY), bottom=stripMetrics(0,h-stripY,w,h), left=stripMetrics(0,0,stripX,h), right=stripMetrics(w-stripX,0,w,h);
    const mTop=(top.sAvg<0.1||top.bwRatio>0.6)? Math.floor(h*0.08):0;
    const mBottom=(bottom.sAvg<0.1||bottom.bwRatio>0.6)? Math.floor(h*0.08):0;
    const mLeft=(left.sAvg<0.1||left.bwRatio>0.6)? Math.floor(w*0.08):0;
    const mRight=(right.sAvg<0.1||right.bwRatio>0.6)? Math.floor(w*0.08):0;
    return { mTop, mBottom, mLeft, mRight };
  }
  async function extractDominantColor(img){
    const MAX_DIM=128;
    const scale=Math.min(1, MAX_DIM/Math.max(img.naturalWidth, img.naturalHeight));
    const w=Math.floor(img.naturalWidth*scale);
    const h=Math.floor(img.naturalHeight*scale);
    const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d',{ willReadFrequently:true });
    ctx.drawImage(img,0,0,w,h);
    const { data }=ctx.getImageData(0,0,w,h);
    const samples=[]; const { mTop,mBottom,mLeft,mRight }=estimateBorderMargins(w,h,data);
    const hueBins=new Array(36).fill(0);
    for(let i=0;i<data.length;i+=4){
      const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3]; if(a<128) continue;
      const idxPix=i/4; const y=Math.floor(idxPix/w); const x=idxPix%w;
      if(y<mTop||y>=h-mBottom||x<mLeft||x>=w-mRight) continue;
      if(isIgnorableColor(r,g,b)) continue;
      const hsv=rgbToHsv(r,g,b);
      const { h:hh, s, v }=hsv;
      const wgt=Math.pow(s,1.2) * (v>0.5? 1 : 0.7);
      if(s<0.05 || v<0.15) continue;
      samples.push({ r,g,b, lab:rgbToLab(r,g,b), w:wgt, h:hsv.h });
      const bin=Math.floor(hsv.h/10); hueBins[bin]+=wgt;
    }
    if(samples.length===0) return { r:200,g:200,b:200 };
    const totalWeight=samples.reduce((sum,s)=>sum+s.w,0);
    const peakIdx=hueBins.reduce((p,cur,i)=> cur>hueBins[p]? i:p,0);
    if(hueBins[peakIdx]/totalWeight > 0.2){
      const peakHue=peakIdx*10+5;
      const band=samples.filter(s=>hsvDist(s.h,peakHue)<=15);
      const bandWeight=band.reduce((sum,s)=>sum+s.w,0);
      if(bandWeight/totalWeight > 0.15){
        let L=0,A=0,B=0,W=0; for(const s of band){ L+=s.lab.L*s.w; A+=s.lab.a*s.w; B+=s.lab.b*s.w; W+=s.w; }
        if(W>0){ const lab={ L:L/W, a:A/W, b:B/W }; return labToRgb(lab.L, lab.a, lab.b); }
      }
    }
    const k=6;
    const centers=initCentersKMeansPP(samples,k).map(c=>({...c, w:0}));
    const maxIter=10; const assignments=new Int32Array(samples.length);
    for(let iter=0;iter<maxIter;iter++){
      for(let i=0;i<samples.length;i++){
        let best=0, bestDist=Infinity; const s=samples[i].lab;
        for(let c=0;c<centers.length;c++){ const cc=centers[c]; const d=(s.L-cc.L)**2+(s.a-cc.a)**2+(s.b-cc.b)**2; if(d<bestDist){ bestDist=d; best=c; } }
        assignments[i]=best;
      }
      const acc=centers.map(()=>({ L:0,a:0,b:0,w:0 }));
      for(let i=0;i<samples.length;i++){ const s=samples[i].lab; const idx=assignments[i]; const wgt=samples[i].w; acc[idx].L+=s.L*wgt; acc[idx].a+=s.a*wgt; acc[idx].b+=s.b*wgt; acc[idx].w+=wgt; }
      for(let c=0;c<centers.length;c++){ if(acc[c].w>0){ centers[c]={ L:acc[c].L/acc[c].w, a:acc[c].a/acc[c].w, b:acc[c].b/acc[c].w, w:0 }; } }
    }
    const finalWeights=new Array(centers.length).fill(0); for(let i=0;i<assignments.length;i++) finalWeights[assignments[i]]+=samples[i].w;
    const order=centers.map((_,i)=>i).sort((a,b)=>finalWeights[b]-finalWeights[a]);
    for(const idx of order){ const rgb=labToRgb(centers[idx].L, centers[idx].a, centers[idx].b); if(!isNearBlackWhite(rgb.r,rgb.g,rgb.b)) return rgb; }
    const i0=order[0]; return labToRgb(centers[i0].L, centers[i0].a, centers[i0].b);
    function initCentersKMeansPP(points,k){
      const cs=[]; if(points.length===0) return cs;
      let maxW=-1, maxIdx=0; for(let i=0;i<points.length;i++){ if(points[i].w>maxW){ maxW=points[i].w; maxIdx=i; } }
      cs.push(points[maxIdx].lab);
      while(cs.length<k){
        const dists=points.map(p=>{ let minD=Infinity; const s=p.lab; for(const c of cs){ const d=(s.L-c.L)**2+(s.a-c.a)**2+(s.b-c.b)**2; if(d<minD) minD=d; } return minD; });
        const sum=dists.reduce((a,b)=>a+b,0); let r=Math.random()*sum; let idx=0; for(let i=0;i<dists.length;i++){ r-=dists[i]; if(r<=0){ idx=i; break; } }
        cs.push(points[idx].lab);
      }
      return cs;
    }
  }
  function normalizeForWhiteContrast(r,g,b,targetL=0.10,minRatio=6.0){
    let Rlin=srgbToLinear(r), Glin=srgbToLinear(g), Blin=srgbToLinear(b);
    let L=0.2126*Rlin+0.7152*Glin+0.0722*Blin; const Lmax=Math.max(0, Math.min(1, (1.05/minRatio)-0.05)); const desired=Math.min(targetL, Lmax);
    if(L===0){ Rlin=desired; Glin=desired; Blin=desired; } else { const k=desired/L; Rlin=Math.min(1,Rlin*k); Glin=Math.min(1,Glin*k); Blin=Math.min(1,Glin*k); }
    const R=clamp(Math.round(linearToSrgb(Rlin)*255)); const G=clamp(Math.round(linearToSrgb(Glin)*255)); const B=clamp(Math.round(linearToSrgb(Blin)*255));
    return { r:R, g:G, b:B };
  }
  function contrastWithWhite(r,g,b){ const L=luminance(r,g,b); return (1.0+0.05)/(L+0.05); }
  global.extractDominantColor=extractDominantColor;
  global.normalizeForWhiteContrast=normalizeForWhiteContrast;
  global.contrastWithWhite=contrastWithWhite;
  global.rgbToHex=rgbToHex;
})(window);
