// One-shot disposable configuration initialization. Never mount this in the backend.
const fs=require('node:fs');
function configure(env=process.env,base='/object-config',data='/object-data') {
  if(env.STAGING_OBJECT_CONFIG_INIT!=='I_ACKNOWLEDGE_DISPOSABLE_OBJECT_STORE')throw Error('EXPLICIT_DISPOSABLE_CONFIGURATION_REQUIRED');
  const names=['STAGING_OBJECT_ADMIN_ACCESS_KEY','STAGING_OBJECT_ADMIN_SECRET_KEY','STAGING_OBJECT_APP_ACCESS_KEY','STAGING_OBJECT_APP_SECRET_KEY'];
  const values=names.map(n=>env[n]||'');
  if(values.some(v=>!/^[a-f0-9]{64}$/.test(v))||new Set(values).size!==4)throw Error('DISTINCT_SYNTHETIC_CREDENTIALS_REQUIRED');
  const bucket='language-coach-c2-local',prefix='community/language-coach-11b-local';
  const policy={Version:'2012-10-17',Statement:[
    {Effect:'Allow',Action:['s3:GetObject','s3:GetObjectVersion','s3:PutObject','s3:DeleteObject'],Resource:[`arn:aws:s3:::${bucket}/${prefix}/*`]},
    {Effect:'Allow',Action:['s3:GetObject'],Resource:[`arn:aws:s3:::${bucket}/control/identity.json`]},
    {Effect:'Allow',Action:['s3:GetBucketVersioning'],Resource:[`arn:aws:s3:::${bucket}`]},
    {Effect:'Deny',Action:['s3:DeleteObjectVersion','s3:PutBucket*','s3:DeleteBucket*','s3:CreateBucket','s3:List*','iam:*','sts:*'],Resource:['*']},
  ]};
  const config={identities:[
    {name:'c2-bootstrap-admin',credentials:[{accessKey:values[0],secretKey:values[1]}],actions:['Admin','Read','Write','List','Tagging']},
    {name:'c2-community-runtime',credentials:[{accessKey:values[2],secretKey:values[3]}],actions:[],policyNames:['c2-community-runtime']},
  ],policies:[{name:'c2-community-runtime',content:JSON.stringify(policy)}]};
  fs.mkdirSync(base,{recursive:true});
  const file=base+'/s3.json',bytes=JSON.stringify(config);
  if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==bytes)throw Error('EXISTING_CONFIGURATION_REQUIRES_EXPLICIT_ROTATION');}
  else fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  fs.chownSync(file,10001,10001);
  // Only ownership, no deletion/reset of either retained volume.
  fs.mkdirSync(data,{recursive:true});fs.chownSync(data,10001,10001);
  fs.mkdirSync(data+'/filerldb2',{recursive:true});fs.chownSync(data+'/filerldb2',10001,10001);
  fs.chownSync(base,10001,10001);fs.chmodSync(base,0o700);
  console.log('Disposable object configuration preserved; separate restricted runtime role; no bucket/data reset.');
}
if(require.main===module){try{configure()}catch{console.error('OBJECT_CONFIGURATION_FAILED');process.exitCode=1}}
module.exports={configure};
