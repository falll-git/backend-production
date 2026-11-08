// One spawned child, bounded settlement on actual CLOSE, not EXIT. Async IPC
// callbacks are fenced so a journal error cannot bypass the caller's finally.
function observeOwnedScenario(child,{timeoutMs,onMessage=()=>{},onClosed=()=>{},abortMessage={type:'abort-owned-scenario'},stopGraceMs=10000,closeGraceMs=30000}={}) {
  return new Promise((resolve,reject)=>{
    let failure,closed=false,killTimer,closeTimer;
    const pending=new Set();
    const stop=error=>{
      if(!failure)failure=error;
      if(closed||killTimer)return;
      // The child closes its own IPC after stopping its tracked children.
      // Parent-side disconnect loses the actual CLOSE event on the installed
      // Windows Node24 runtime (proved by the finite native regression).
      try{if(child.connected)child.send(abortMessage,()=>{});}catch{}
      if(closed)return;
      killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},stopGraceMs);
      closeTimer=setTimeout(()=>{
        if(closed)return;
        clearTimeout(timer);clearTimeout(killTimer);
        const error=Error('SCENARIO_CLOSE_UNCONFIRMED_RETAIN_RESOURCES');
        error.code='SCENARIO_CLOSE_UNCONFIRMED';reject(error);
      },closeGraceMs);
    };
    child.on('error',()=>stop(Error('SCENARIO_SPAWN_FAILED')));
    child.on('message',message=>{
      const work=Promise.resolve().then(()=>onMessage(message));pending.add(work);
      work.catch(()=>stop(Error('SCENARIO_MESSAGE_OR_JOURNAL_FAILED'))).finally(()=>pending.delete(work));
    });
    child.once('close',(code,signal)=>{
      closed=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(closeTimer);
      Promise.allSettled([...pending]).then(()=>{onClosed();failure?reject(failure):resolve({code,signal});}).catch(reject);
    });
    // Logs deliberately stay private to the runtime: never echo SQL, payloads,
    // credentials or private fixture details into the parent report.
    child.stdout?.on('data',()=>{});child.stderr?.on('data',()=>{});
    child.stdout?.on('error',()=>stop(Error('SCENARIO_STDOUT_FAILED')));
    child.stderr?.on('error',()=>stop(Error('SCENARIO_STDERR_FAILED')));
    const timer=setTimeout(()=>stop(Error('SCENARIO_TIMEOUT')),timeoutMs);
  });
}
module.exports={observeOwnedScenario};
