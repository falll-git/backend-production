'use strict';
const assert=require('node:assert/strict');
const {assertLive}=require('./sj-disposable-guard');
// Test-only capability scope. The real adapter stays enabled only while the
// owned Step6 UI journey needs it; normal runtime and negative gates do not.
async function withOwnedRecovery({proof,token,cross},action,verify=assertLive,env=process.env){
 assert.equal(env.NODE_ENV,'test');assert.equal(cross?.uiStep6,true);
 assert.ok(cross.bankUiRoot&&cross.publicUiRoot&&cross.browserRoot);
 assert.equal(typeof action,'function');
 await verify(proof,env,token);
 const previous=env.SJ_CONTROL_RECOVERY_ENABLED;
 try{env.SJ_CONTROL_RECOVERY_ENABLED='true';return await action();}
 finally{if(previous===undefined)delete env.SJ_CONTROL_RECOVERY_ENABLED;else env.SJ_CONTROL_RECOVERY_ENABLED=previous;}
}
module.exports={withOwnedRecovery};
