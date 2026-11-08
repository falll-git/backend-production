// Second, distinct bank installation. Private IPC only; no worker or mock bank.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {assertLive}=require('./sj-disposable-guard');
let server,prisma,closing=false,finished=false;
async function close(){if(closing)return;closing=true;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await prisma?.$disconnect();}
process.once('disconnect',()=>{if(!finished)close().finally(()=>process.exit(1));});
process.once('message',async({proof,token,actors})=>{
  process.on('message',message=>{if(message.type==='abort-owned-scenario'&&message.runId===proof.runId&&message.tokenHash===proof.tokenHash&&process.connected)process.disconnect();});
  try{
    const express=require('express'),app=express();
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const origin='http://127.0.0.1:'+server.address().port;
    proof.integrationOrigin=origin;
    Object.assign(process.env,{SJ_CONTROL_BASE_URL:origin,SJ_TEST_CENTRAL_BASE_URL:origin,
      JWT_SECRET:crypto.randomBytes(48).toString('hex'),JWT_EXPIRES_IN:'30m'});
    await assertLive(proof,process.env,token);
    global.fetch=()=>{throw Error('ISOLATION_PEER_EGRESS_FORBIDDEN');};
    prisma=require('../../config/prisma');
    app.use(express.json());app.use('/api/v1/seputar-jaminan',require('../../modules/seputar-jaminan/seputarJaminan.route'));
    const access=require('../../utils/jwt').generateAccessToken({id:actors.maker.id,session_id:actors.maker.session_id});
    process.on('message',async message=>{
      if(message.type!=='stop-bank-isolation-peer'||message.runId!==proof.runId||message.tokenHash!==proof.tokenHash)return;
      await close();finished=true;process.send({type:'result',pass:true,checks:[{check:'second real bank API closed after symmetric installation-isolation proof',pass:true}],integrationOrigin:origin},()=>process.disconnect());
    });
    // Sensitive runtime credential travels only over the owned IPC channel,
    // never stdout, reports, callbacks or application responses.
    process.send({type:'bank-isolation-ready',proof,bank:{origin,actorId:actors.maker.id,token:access,databaseUrl:process.env.DATABASE_URL}});
  }catch(error){await close();finished=true;process.exitCode=1;process.send({type:'result',pass:false,code:error.code||error.name,checks:[]},()=>process.disconnect());}
});
