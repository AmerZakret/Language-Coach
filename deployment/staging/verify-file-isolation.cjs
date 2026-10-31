// HOST_OPERATOR_TOOL: requires Docker administration, absent from app/tooling images.
// A local isolation snapshot is not a production or multi-instance authorization.
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const usesObjects=(project,containers)=>project==='language-coach-c2-validation'||containers.some(c=>
  ['object-data','object-store'].includes(c.Config.Labels?.['com.docker.compose.service'])||c.Config.Env?.includes('UPLOAD_STORAGE_BACKEND=S3'));
function validateInventory(project, containers, networks) {
  if (!/^language-coach-(?:11b-local|c1(?:-r2)?-validation|c2-validation)$/.test(project)) throw Error('DISPOSABLE_PROJECT_REQUIRED');
  const shared=usesObjects(project,containers);
  const stores={};
  for(const c of containers){
    if(c.Config.Labels?.['com.docker.compose.project']!==project)throw Error('PROJECT_IDENTITY_MISMATCH');
    const service=c.Config.Labels['com.docker.compose.service'];
    if((shared?['mongo','authority','object-data','object-store']:['mongo','authority']).includes(service)){
      if(!c.State.Running || c.HostConfig.Privileged || Object.keys(c.HostConfig.PortBindings||{}).length)throw Error('PRIVATE_RUNNING_STORES_REQUIRED');
      if(stores[service])throw Error('DUPLICATE_STORE');stores[service]=c;
    }else if(c.State.Running || !['','no'].includes(c.HostConfig.RestartPolicy?.Name||''))throw Error('WRITER_NOT_STOPPED_OR_RESTART_ENABLED');
  }
  if(!stores.mongo||!stores.authority)throw Error('STORES_REQUIRED');
  if(shared&&(!stores['object-data']||!stores['object-store']||stores['object-data'].Config.Image!=='chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8'||
     !stores['object-data'].Mounts.some(m=>m.Destination==='/data'&&m.Name===project+'_object-data')||stores['object-store'].Config.Image!=='caddy:2.11.6-alpine'))throw Error('PRIVATE_OBJECT_STORES_REQUIRED');
  if(stores.mongo.Config.Image!=='mongo:7.0.45-jammy'||stores.authority.Config.Image!=='postgres:17.9-bookworm')throw Error('DISPOSABLE_STORE_IMAGES_REQUIRED');
  for(const[service,destination,volume]of[['mongo','/data/db','mongo-data'],['authority','/var/lib/postgresql/data','authority-data']]){
    if(!stores[service].Mounts.some(m=>m.Destination===destination&&m.Name===project+'_'+volume))throw Error('STORE_VOLUME_IDENTITY_MISMATCH');
  }
  for(const network of networks){
    if(!network.Internal||!network.Name.startsWith(project+'_'))throw Error('PRIVATE_PROJECT_NETWORK_REQUIRED');
    const expected=network.Name===project+'_control'?[stores.authority.Id]:network.Name===project+'_database'?[stores.mongo.Id]:
      shared&&network.Name===project+'_objects'?[stores['object-store'].Id]:shared&&network.Name===project+'_object-control'?[stores['object-store'].Id,stores['object-data'].Id]:null;
    if(!expected||Object.keys(network.Containers||{}).some(id=>!expected.includes(id)))throw Error('UNISOLATED_NETWORK_ENDPOINT');
  }
  if(networks.length!==(shared?4:2))throw Error('BOTH_PRIVATE_NETWORKS_REQUIRED');
  return stores;
}
function main(args=process.argv.slice(2)){
  if(args[0]!=='--project'||![2,7].includes(args.length))throw Error('EXPLICIT_ISOLATION_ARGUMENTS_REQUIRED');
  const project=args[1];if(!/^language-coach-(?:11b-local|c1(?:-r2)?-validation|c2-validation)$/.test(project))throw Error('DISPOSABLE_PROJECT_REQUIRED');
  const issue=args.length===7;
  if(issue&&(args[2]!=='--effect'||!uuid.test(args[3])||args[4]!=='--reference'||!/^[A-Za-z0-9._:/-]{1,96}$/.test(args[5])||args[6]!=='--issue-receipt'))throw Error('EXPLICIT_EFFECT_RECEIPT_REQUIRED');
  const docker=(a,input)=>execFileSync('docker',a,{input,encoding:'utf8',maxBuffer:4*1024*1024,timeout:20000});
  if(docker(['context','show']).trim()!=='desktop-linux')throw Error('DISPOSABLE_DESKTOP_CONTEXT_REQUIRED');
  const ids=docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]).trim().split(/\s+/).filter(Boolean);
  if(!ids.length)throw Error('PROJECT_NOT_FOUND');
  const containers=JSON.parse(docker(['inspect',...ids]));
  const shared=usesObjects(project,containers);
  const networks=JSON.parse(docker(['network','inspect',project+'_control',project+'_database',...(shared?[project+'_objects',project+'_object-control']:[])]));
  const stores=validateInventory(project,containers,networks);
  const mongo=JSON.parse(docker(['exec',stores.mongo.Id,'mongosh','--quiet','--eval',
    "const h=db.hello();if(h.setName!=='staging-rs'||!h.isWritablePrimary)throw Error('DISPOSABLE_PRIMARY_REQUIRED');const ops=db.getSiblingDB('admin').aggregate([{$currentOp:{allUsers:true,idleConnections:true,idleSessions:true}}]).toArray().filter(o=>o.transaction||(((o.ns||'').startsWith('lingua_staging.')||o.command?.$db==='lingua_staging')&&o.active));print(JSON.stringify({outstandingMongoOperations:ops.length}));"]));
  if(mongo.outstandingMongoOperations!==0)throw Error('MONGO_WORK_NOT_DRAINED');
  const query=s=>docker(['exec','-i',stores.authority.Id,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','authority_admin','-d','timeline_authority'],s).trim();
  const pg=JSON.parse(query("SELECT json_build_object('state',(SELECT row_to_json(s) FROM timeline_authority.state s),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()),'effectStartedAt',(SELECT max(started_at) FROM timeline_authority.file_effects WHERE status='ACTIVE'),'effects',(SELECT coalesce(json_agg(effect_id),'[]'::json) FROM timeline_authority.file_effects WHERE status='ACTIVE'));"));
  if(!pg.state||!['CLOSED','MAINTENANCE'].includes(pg.state.mode)||pg.sessions!==0||pg.state.storage_identity!==project+'_authority-data')throw Error('CLOSED_AUTHORITY_AND_DRAINED_CONNECTIONS_REQUIRED');
  const evidence={project,containers:containers.map(c=>({id:c.Id,service:c.Config.Labels['com.docker.compose.service'],running:c.State.Running,restart:c.HostConfig.RestartPolicy?.Name})),mongo,authority:pg};
  const sha256=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  let receiptId;
  if(issue){
    if(shared&&['object-data','object-store'].some(name=>Date.parse(stores[name].State.StartedAt)<=Date.parse(pg.effectStartedAt)))throw Error('REMOTE_OBJECT_WORK_MUST_BE_TERMINATED_BY_ISOLATED_STORE_RESTART');
    if(pg.state.mode!=='CLOSED'||!pg.effects.includes(args[3]))throw Error('PENDING_EFFECT_IN_CLOSED_REQUIRED');
    receiptId=randomUUID();
    // Values are validated public identities/UUIDs, never credentials or user data.
    if(!/^[a-z][a-z0-9._-]{0,63}$/.test(pg.state.environment)||!Number.isSafeInteger(pg.state.revision))throw Error('INVALID_AUTHORITY_IDENTITY');
    query(`SELECT timeline_authority.record_file_isolation('${receiptId}'::uuid,'${args[3]}'::uuid,'${pg.state.environment}','${pg.state.storage_identity}',${pg.state.revision},'${args[5]}','${sha256}');`);
  }
  return{status:'DISPOSABLE_FILE_ISOLATION_VERIFIED',project,revision:pg.state.revision,generation:pg.state.generation,pendingEffects:pg.effects,sha256,...(receiptId?{receiptId}:{}),productionAuthorized:false,restartFreezeStillRequired:true};
}
if(require.main===module){try{console.log(JSON.stringify(main()))}catch{console.error('FILE_ISOLATION_FAILED; keep writes closed. No receipt issued without verification.');process.exitCode=1}}
module.exports={validateInventory,main};
