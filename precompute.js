// Runs the three examples through the real pipeline and saves the results, so the app opens already working.
const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.goto('http://localhost:8790/harness.html');
const out={};
for(const f of ['ex_line.png','ex_bars.png','ex_dots.png']){
 out[f]=await p.evaluate(async f=>{const im=new Image();im.src='/examples/'+f;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0);
  const t0=performance.now();const words=await UnchartOCR.readWords(c,{workerPath:'/node_modules/tesseract.js/dist/worker.min.js',corePath:'/node_modules/tesseract.js-core/',langPath:'/node_modules/@tesseract.js-data/eng/4.0.0_best_int'});
  const r=Unchart.extract(c.getContext('2d').getImageData(0,0,c.width,c.height),words);const ms=performance.now()-t0;
  return {ok:r.ok,rect:r.rect,flags:r.flags,notes:r.notes,axis:r.axis,calib:r.calib,ms:Math.round(ms),
   series:r.series.map(s=>({type:s.type,name:s.name,color:s.color,size:s.size,points:s.points.map(q=>({x:q.x,y:q.y,px:q.px,py:q.py,box:q.box,empty:q.empty,merged:q.merged}))})),
   words:words.map(w=>({text:w.text,x0:w.x0,y0:w.y0,x1:w.x1,y1:w.y1}))}},f);
 console.log(f,out[f].ok,out[f].ms,out[f].series.map(s=>s.name+':'+s.points.length));}
fs.writeFileSync('examples/precomputed.js','window.UNCHART_EXAMPLES='+JSON.stringify(out)+';');await b.close()})();
