// Finite native Node lifecycle fixture only. No DB, browser or external I/O.
if(process.argv.length!==3||!['natural','stop'].includes(process.argv[2]))process.exit(2);
process.stdout.write('owned-fixture-ready\n');
process.stderr.write('owned-fixture-stderr\n');
setTimeout(()=>{process.stdout.write('owned-fixture-final-tail\n');},process.argv[2]==='natural'?20:2000);
setTimeout(()=>process.exit(0),process.argv[2]==='natural'?30:2500);
