// Finite native Node fixture, no application/database/container access.
const timer=setInterval(()=>{},1000);
process.on('disconnect',()=>{clearInterval(timer);process.exitCode=7;});
process.on('message',()=>process.disconnect());
process.send({type:'progress'});
