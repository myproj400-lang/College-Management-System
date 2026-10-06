const fs = require('node:fs');
(async () => {
  const pages = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id) { const task = pending.get(msg.id); pending.delete(msg.id); if(msg.error) task.reject(msg.error); else task.resolve(msg.result); } });
  const send = (method, params = {}) => new Promise((resolve,reject) => { const key = ++id; pending.set(key, {resolve,reject}); ws.send(JSON.stringify({id:key,method,params})); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width:1536,height:1024,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate', {url:'http://127.0.0.1:4173/login'});
  await new Promise(r => setTimeout(r,3000));
  console.log(JSON.stringify(await send('Runtime.evaluate', {expression:'JSON.stringify({title:document.title,text:document.body.innerText.slice(0,250),width:document.documentElement.scrollWidth,errors:document.querySelector("vite-error-overlay")?.textContent})',returnByValue:true})));
  const screenshot = await send('Page.captureScreenshot', {format:'png'});
  fs.writeFileSync('docs/frontend-previews/login-desktop.png',Buffer.from(screenshot.data,'base64'));
  ws.close();
})().catch(e => {console.error(e);process.exit(1)});
