const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.goto('http://localhost:8790/bench/make_chartjs.html');
const T=[];for(let i=0;i<30;i++){const r=await p.evaluate(i=>window.make(i),i);fs.writeFileSync('bench/charts2/'+r.truth.file,Buffer.from(r.png.split(',')[1],'base64'));T.push(r.truth);}
fs.writeFileSync('bench/charts2/truth.json',JSON.stringify(T));await b.close();console.log(T.length)})();
