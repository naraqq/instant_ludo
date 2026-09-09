import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const baseURL = process.env.SMOKE_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
const errors=[];
const pages=[];
for(let i=0;i<2;i++) {
 const page=await browser.newPage({viewport:{width:450,height:800}});
 page.on('pageerror',e=>errors.push(e.stack));
 page.on('console',m=>{if(m.type()==='warning' && m.text().includes('[net]'))errors.push(m.text())});
 await page.goto(baseURL);
 await page.waitForFunction(()=>window.__PHASER_GAME__?.scene.getScene('Home')?.playBtn);
 pages.push(page);
}
const [host,guest]=pages;
await host.evaluate(()=>window.__PHASER_GAME__.scene.getScene('Home').goTo('NetLudo',{mode:'create',maxPlayers:2}));
await host.waitForFunction(()=>window.__PHASER_GAME__.scene.getScene('NetLudo').room?.state.code);
const code=await host.evaluate(()=>window.__PHASER_GAME__.scene.getScene('NetLudo').room.state.code);
await guest.evaluate(code=>window.__PHASER_GAME__.scene.getScene('Home').goTo('NetLudo',{mode:'code',code}),code);
for(const page of pages)await page.waitForFunction(()=>window.__PHASER_GAME__.scene.getScene('NetLudo').pawns.length===8);
await host.waitForTimeout(800);
console.log('CONNECTED',await Promise.all(pages.map(p=>p.evaluate(()=>{const s=window.__PHASER_GAME__.scene.getScene('NetLudo');return {color:s.myColor,phase:s.phase,zone:!!s.lobbyStartZone}}))));
for(let i=0;i<30;i++){
 for(const page of pages) await page.evaluate(()=>{
 const s=window.__PHASER_GAME__.scene.getScene('NetLudo');
 if(s._gatePickChoose)s._gatePickChoose('water');
 if(!s.myTurn || s._pendingBatches)return;
 if(s.phase==='roll')s.rollDice();
 else if(s.phase==='move'){const pawn=s.pawns.find(p=>p.color===s.myColor&&s.canMove(p));if(pawn)s.tryMovePawn(pawn)}
 });
 await host.waitForTimeout(500);
}
await host.waitForTimeout(1800);
const states=await Promise.all(pages.map(p=>p.evaluate(()=>{const s=window.__PHASER_GAME__.scene.getScene('NetLudo');return {g:JSON.parse(s.room.state.gameJson),views:s.pawnViews.size,animating:s._animating,queue:s._pendingBatches,phase:s.phase,windup:!!s._windup}})));
assert.deepEqual(states[0].g,states[1].g);
console.log('SYNC',states.map(s=>({turn:s.g.turn,views:s.views,animating:s.animating,queue:s.queue,phase:s.phase,windup:s.windup})));
const beforeDrop = await host.evaluate(() => {
 const s = window.__PHASER_GAME__.scene.getScene('NetLudo');
 const seat = { roomId: s.room.roomId, color: s.myColor, sessionId: s.room.sessionId };
 window.__testDrops = 0;
 s.room.onDrop(() => window.__testDrops++);
 s.room.connection.close(4010, 'smoke test reconnect');
 return seat;
});
await host.waitForFunction(() => window.__testDrops > 0);
await host.waitForFunction(() => {
 const s = window.__PHASER_GAME__.scene.getScene('NetLudo');
 return s._connected && !s.room.reconnection.isReconnecting;
}, null, {timeout:20000});
await host.waitForTimeout(2000);
const afterDrop = await host.evaluate(() => {
 const s = window.__PHASER_GAME__.scene.getScene('NetLudo');
 return { roomId: s.room.roomId, color: s.myColor, sessionId: s.room.sessionId };
});
assert.deepEqual(afterDrop, beforeDrop);
console.log('RECONNECTED', afterDrop.color);
await host.screenshot({path:join(tmpdir(), 'ludo-online.png')});
await host.evaluate(()=>window.__PHASER_GAME__.scene.getScene('NetLudo').goTo('Home'));
await host.waitForFunction(()=>window.__PHASER_GAME__.scene.isActive('Home'));
await host.evaluate(()=>window.__PHASER_GAME__.scene.getScene('Home').goTo('NetLudo',{mode:'solo',maxPlayers:2}));
await host.waitForFunction(()=>window.__PHASER_GAME__.scene.getScene('NetLudo').pawns.length===8 && window.__PHASER_GAME__.scene.isActive('NetLudo'));
await host.waitForTimeout(1200);
console.log('RESTART',await host.evaluate(()=>{const s=window.__PHASER_GAME__.scene.getScene('NetLudo');return {views:s.pawnViews.size,phase:s.phase,animating:s._animating}}));
console.log('ERRORS',errors);
assert.deepEqual(errors,[]);
} finally {
  await browser.close();
}
