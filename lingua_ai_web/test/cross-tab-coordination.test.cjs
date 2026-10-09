const assert=require('node:assert/strict');
const {test}=require('node:test');
const {origin,A,B,user,ownerKey,tick,deferred}=require('./helpers/browserContexts.cjs');
const owner=`registered_${A}`;
const completion=(lesson='one',epoch=0)=>({lessonId:lesson,score:73,progressEpoch:epoch,targetLanguage:'en',_lessonLanguageBound:true,xpReward:10});
const create=(temp='local_one')=>({tempId:temp,targetWord:temp,turkishTranslation:'translation',targetLanguage:'en'});
async function pair(){const o=origin(),a=o.tab(),b=o.tab();await a.install();o.values.set(`progress_epoch_${owner}`,'0');return {o,a,b};}
const queueState=(o,who=owner)=>JSON.parse(o.values.get(ownerKey(who))||'{"actions":[],"tempIds":{},"failedActions":[]}');
const state=(o)=>JSON.parse(o.values.get('linguaai_session_v1'));

test('two independent contexts concurrently append without lost IDs or payloads',async()=>{
 const {o,a,b}=await pair();
 await Promise.all([a.queue.pushToOfflineQueue('complete-lesson',completion('one'),owner),b.queue.pushToOfflineQueue('complete-lesson',completion('two'),owner)]);
 const actions=queueState(o).actions;assert.equal(actions.length,2);assert.equal(new Set(actions.map(a=>a.id)).size,2);
 assert.deepEqual(actions.map(a=>a.payload.lessonId).sort(),['one','two']);assert.ok(actions.every(a=>a.ownerNamespace===owner&&a.payload.progressEpoch===0));
});

test('mapping acknowledgement and dependent rewrites compose with another context compaction',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('create-flashcard',create(),owner);await b.queue.pushToOfflineQueue('create-flashcard',create('local_two'),owner);
 const started=deferred(),reply=deferred();let count=0;
 a.dispatch=async req=>{count++;if(count===1){started.resolve();await reply.promise;}return {data:{_id:count===1?'server_one':'server_two'}};};
 const draining=a.queue.processOfflineQueue(A,true);await started.promise;
 await b.queue.pushToOfflineQueue('review-flashcard',{cardId:'local_one',score:4},owner);
 await b.queue.pushToOfflineQueue('update-flashcard',{cardId:'local_two',note:'edited'},owner);
 reply.resolve();assert.equal(await draining,true);
 const stored=queueState(o);assert.deepEqual(stored.tempIds,{local_one:'server_one',local_two:'server_two'});
 assert.equal(stored.actions.length,1);assert.equal(stored.actions[0].payload.cardId,'server_one');assert.equal(a.requests[1].data.note,'edited');
});

test('same-owner drains exclude dispatch and reload after waiting; append and ack retain newer work',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const started=deferred(),reply=deferred();a.dispatch=async req=>{started.resolve();await reply.promise;return {data:{data:{progressEpoch:req.data.progressEpoch}}};};
 const first=a.queue.processOfflineQueue(A,true);await started.promise;
 const second=b.queue.processOfflineQueue(A,true);await tick();assert.equal(b.requests.length,0);
 await b.queue.pushToOfflineQueue('complete-lesson',completion('new'),owner);
 const newId=queueState(o).actions[1].id;
 reply.resolve();assert.equal(await first,true);assert.equal(await second,true);
 assert.equal(b.requests.length,1);assert.equal(b.requests[0].headers['X-Idempotency-Key'],newId);assert.equal(queueState(o).actions.length,0);
});

test('quarantine cannot erase concurrent append or dependency; immutable metadata retained',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('create-flashcard',create(),owner);
 const started=deferred(),reply=deferred();a.dispatch=async()=>{started.resolve();await reply.promise;throw {response:{status:403}};};
 const draining=a.queue.processOfflineQueue(A,true);await started.promise;
 await b.queue.pushToOfflineQueue('review-flashcard',{cardId:'local_one',score:4},owner);
 await b.queue.pushToOfflineQueue('complete-lesson',completion('new'),owner);
 const ids=queueState(o).actions.map(a=>a.id);reply.resolve();assert.equal(await draining,false);
 const stored=queueState(o);assert.equal(stored.actions[0].id,ids[2]);assert.deepEqual(stored.failedActions.map(a=>a.id),ids.slice(0,2));
 assert.equal(stored.failedActions[0].lastErrorCategory,'forbidden');assert.equal(stored.failedActions[0].attemptCount,1);
 assert.equal(stored.failedActions[1].payload.score,4);assert.ok(stored.failedActions.every(a=>a.ownerNamespace===owner&&a.failedAt));
});

test('retry metadata remains one attempt while another drain waits and another context appends',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const started=deferred(),reply=deferred();a.dispatch=async()=>{started.resolve();await reply.promise;throw {response:{status:503}};};
 const first=a.queue.processOfflineQueue(A,true);await started.promise;const second=b.queue.processOfflineQueue(A,true);
 await b.queue.pushToOfflineQueue('complete-lesson',completion('two'),owner);reply.resolve();assert.equal(await first,false);assert.equal(await second,false);
 const stored=queueState(o);assert.equal(stored.actions.length,2);assert.equal(stored.actions[0].attemptCount,1);
 assert.equal(stored.actions[0].lastErrorCategory,'backend');assert.ok(Date.parse(stored.actions[0].nextAttemptAt)>Date.now());assert.equal(b.requests.length,0);
});

test('reset barrier survives in-flight completion acknowledgement from another tab',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const started=deferred(),reply=deferred();a.dispatch=async req=>{started.resolve();await reply.promise;return {data:{data:{progressEpoch:req.data.progressEpoch}}};};
 const first=a.queue.processOfflineQueue(A,true);await started.promise;
 await b.queue.pushToOfflineQueue('reset-progress',{expectedEpoch:0},owner,true);const id=queueState(o).actions[0].id;
 reply.resolve();assert.equal(await first,true);assert.equal(queueState(o).actions.length,1);assert.equal(queueState(o).actions[0].id,id);
 assert.equal(await b.queue.processOfflineQueue(A,true),true);assert.equal(o.values.get(`progress_epoch_${owner}`),'1');
 await assert.rejects(a.queue.pushToOfflineQueue('complete-lesson',completion('old',0),owner,true),/Progress changed/);
 await a.queue.pushToOfflineQueue('complete-lesson',completion('fresh',1),owner,true);assert.equal(queueState(o).actions[0].payload.progressEpoch,1);
});

test('serialized server snapshots cannot lower epoch or overwrite a concurrent progress revision',async()=>{
 const {o,a,b}=await pair();const revision=a.queue.getProgressQueueRevision(owner);
 await b.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const snapshot={progressEpoch:0,totalXp:0,streak:0,weeklyActivity:[],completedLessonIds:[]};
 assert.equal(await a.queue.saveServerProgress(owner,'English',revision,snapshot),false);
 const gate=deferred(),started=deferred();const held=b.navigator.locks.request(`linguaai:queue:storage:${owner}`,async()=>{started.resolve();await gate.promise;});await started.promise;
 const save=a.queue.saveServerProgress(owner,'English',a.queue.getProgressQueueRevision(owner),snapshot);
 o.values.set(`progress_epoch_${owner}`,'1');gate.resolve();await held;assert.equal(await save,false);assert.equal(o.values.get(`progress_epoch_${owner}`),'1');
});

test('tab teardown releases a held mutation lock and a waiting tab preserves durable action',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const started=deferred(),gate=deferred();const held=a.navigator.locks.request(`linguaai:queue:storage:${owner}`,async()=>{started.resolve();await gate.promise;});
 const closed=assert.rejects(held,/Context closed/);await started.promise;
 const appended=b.queue.pushToOfflineQueue('complete-lesson',completion('two'),owner);await tick();assert.equal(queueState(o).actions.length,1);
 a.close();await closed;await appended;gate.resolve();assert.equal(queueState(o).actions.length,2);
});

test('closing during HTTP releases drain; next context retries same durable operation and safe receipt',async()=>{
 const {o,a,b}=await pair();await a.queue.pushToOfflineQueue('create-flashcard',create(),owner);
 const id=queueState(o).actions[0].id,started=deferred(),reply=deferred();let effects=0;const receipts=new Map();
 const commit=req=>{const key=req.headers['X-Idempotency-Key'];if(!receipts.has(key)){effects++;receipts.set(key,{data:{_id:'server_one'}});}return receipts.get(key);};
 a.dispatch=async req=>{const receipt=commit(req);started.resolve();await reply.promise;return receipt;};b.dispatch=async req=>commit(req);
 const first=a.queue.processOfflineQueue(A,true);const closed=assert.rejects(first,/Context closed/);await started.promise;
 const second=b.queue.processOfflineQueue(A,true);await tick();assert.equal(b.requests.length,0);a.close();await closed;
 assert.equal(await second,true);assert.equal(effects,1);assert.equal(b.requests[0].headers['X-Idempotency-Key'],id);
 assert.equal(queueState(o).actions.length,0);assert.equal(queueState(o).tempIds.local_one,'server_one');reply.resolve();await tick();
});

test('different owner lock names are independent and waiting owner session is revalidated',async()=>{
 const {o,a,b}=await pair();const started=deferred(),gate=deferred();const held=a.navigator.locks.request(`linguaai:queue:storage:${owner}`,async()=>{started.resolve();await gate.promise;});await started.promise;
 const stale=a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);const rejected=assert.rejects(stale,/owner\/session changed/);
 await b.install(user(B));await b.queue.pushToOfflineQueue('create-flashcard',create(),`registered_${B}`);
 gate.resolve();await held;await rejected;assert.equal(queueState(o).actions.length,0);assert.equal(queueState(o,`registered_${B}`).actions.length,1);
});

test('auth replacements expose only coherent serialized records and retire legacy fields',async()=>{
 const {o,a,b}=await pair();await Promise.all([a.authStorage.replaceStoredSession(user(A),`token-${A}`),b.authStorage.replaceStoredSession(user(B),`token-${B}`)]);
 for(const entry of o.writes.filter(w=>w.key==='linguaai_session_v1')) {const record=JSON.parse(entry.value);assert.equal(record.token,`token-${record.user.id}`);assert.equal(record.user.targetLanguage,'en');assert.ok(record.revision);}
 for(const key of ['linguaai_user','linguaai_token','linguaai_is_guest','linguaai_session_revision'])assert.equal(o.values.has(key),false);
 assert.equal(state(o).token,`token-${state(o).user.id}`);
});

test('cross-tab A to B blocks old draft before render, updates auth and remounts session subtree',async()=>{
 const {o,a,b}=await pair();await a.mount();await b.mount();await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);
 const oldIntent=a.session.getSessionRequestConfig(),oldKey=a.tree.props.children.props.key;
 await b.authStorage.replaceStoredSession(user(B),`token-${B}`);
 await assert.rejects(a.client.post('/community/posts',{text:'A draft'}),/Session changed/);assert.equal(a.requests.length,0);
 await o.flush();assert.equal(a.auth.user.id,B);assert.equal(a.auth.token,`token-${B}`);assert.notEqual(a.tree.props.children.props.key,oldKey);
 await assert.rejects(a.client.post('/community/posts',{text:'A stale callback'},oldIntent),/Session changed/);
 assert.equal(await a.queue.processOfflineQueue(A,true),false);assert.equal(queueState(o).actions[0].ownerNamespace,owner);
 await a.client.post('/community/posts',{text:'fresh B draft'});assert.equal(a.requests[0].headers.Authorization,`Bearer token-${B}`);
 await b.auth.logout();await o.flush();assert.equal(a.auth.user,null);assert.equal(queueState(o).actions.length,1);
});

for(const [from,to]of [[user(A),user(B,true)],[user(A,true),user(B)],[user(A),{id:'guest',name:'Guest',email:'guest@lingua.ai',isGuest:true}],[{id:'guest',name:'Guest',email:'guest@lingua.ai',isGuest:true},user(B)]]) {
 test(`cross-tab owner transition ${from.isGuest?'guest':'registered'}:${from.id} -> ${to.isGuest?'guest':'registered'}:${to.id}`,async()=>{
  const o=origin(),a=o.tab(),b=o.tab();await a.install(from,from.id==='guest'?null:`token-${from.id}`);await a.mount();await b.mount();
  const old=a.session.getOfflineQueueSession();await a.queue.pushToOfflineQueue('create-flashcard',create(),old.ownerNamespace);
  await b.authStorage.replaceStoredSession(to,to.id==='guest'?null:`token-${to.id}`);
  await assert.rejects(a.client.post('/community/posts',{text:'old intent'}),/Session changed/);await o.flush();
  assert.equal(a.auth.user.id,to.id);assert.equal(a.auth.token,to.id==='guest'?null:`token-${to.id}`);assert.equal(queueState(o,old.ownerNamespace).actions[0].ownerNamespace,old.ownerNamespace);
  assert.equal(await a.queue.processOfflineQueue(from.id,true),false);assert.equal(a.requests.length,0);
 });
}

test('conditional old-session profile write is checked inside auth lock',async()=>{
 const {o,a,b}=await pair();const expected=state(o).revision,started=deferred(),gate=deferred();
 const held=b.navigator.locks.request('linguaai:auth:session',async()=>{started.resolve();await gate.promise;});await started.promise;
 const switched=b.authStorage.replaceStoredSession(user(B),`token-${B}`);
 const stale=a.authStorage.replaceStoredSession({...user(A),name:'stale'},`token-${A}`,expected);
 gate.resolve();await held;assert.equal(await switched,true);assert.equal(await stale,false);assert.equal(state(o).user.id,B);
});

test('notifications are owner-filtered and wake for append, acknowledgement and quarantine',async()=>{
 const {o,a,b}=await pair();const changes=[];b.queue.subscribeOfflineQueue(external=>changes.push(external));
 await a.queue.pushToOfflineQueue('complete-lesson',completion(),owner);await o.flush();assert.ok(changes.includes(true));changes.length=0;
 await a.queue.processOfflineQueue(A,true);await o.flush();assert.ok(changes.includes(true));
 await a.queue.pushToOfflineQueue('complete-lesson',completion('failed'),owner);a.dispatch=async()=>{throw {response:{status:400,data:{code:'STALE_PROGRESS_EPOCH'}}};};
 await a.queue.processOfflineQueue(A,true);await o.flush();assert.equal(b.queue.getFailedOfflineActions().length,1);assert.ok(changes.length<12);
 const before=changes.length;o.values.set(ownerKey(`registered_${B}`),'{}');for(const listener of b.listeners)listener({key:ownerKey(`registered_${B}`),storageArea:b.localStorage});assert.equal(changes.length,before);
});

test('local_guest mutations coordinate, preserve tokenless identity and never drain backend',async()=>{
 const o=origin(),a=o.tab(),b=o.tab();await a.install(a.authStorage.localGuestUser,null);
 await Promise.all([a.queue.pushToOfflineQueue('create-flashcard',create(), 'local_guest'),b.queue.pushToOfflineQueue('create-flashcard',create('local_two'),'local_guest')]);
 assert.equal(queueState(o,'local_guest').actions.length,2);assert.equal(state(o).token,null);assert.equal(await a.queue.processOfflineQueue('guest',true),false);assert.equal(a.requests.length,0);
});

test('unsupported browser rejects coordinated mutations, preserves existing work, permits atomic auth and direct online calls',async()=>{
 const o=origin(),a=o.tab(false);await a.install();const raw=JSON.stringify({schemaVersion:2,ownerNamespace:owner,actions:[],tempIds:{local_one:'server_one'},startedCreates:[],failedActions:[]});o.values.set(ownerKey(owner),raw);
 await assert.rejects(a.queue.pushToOfflineQueue('create-flashcard',create(),owner),/Web Locks/);
 await assert.rejects(a.queue.preparePendingProgress(owner),/Web Locks/);await assert.rejects(a.queue.clearOfflineQueue(),/Web Locks/);
 assert.equal(await a.queue.processOfflineQueue(A,true),false);assert.equal(o.values.get(ownerKey(owner)),raw);
 await a.client.post('/community/posts',{text:'current online intent'});assert.equal(a.requests[0].headers.Authorization,`Bearer token-${A}`);
});

test('legacy mixed identity is not assigned: only verified profile binds migrated token',async()=>{
 const o=origin();o.values.set('linguaai_user',JSON.stringify(user(A)));o.values.set('linguaai_token',`token-${B}`);
 const a=o.tab(),profile=deferred();a.fetchMe=()=>profile.promise;a.render();await o.flush();
 assert.equal(state(o).user,null);assert.equal(state(o).pendingVerification,true);assert.equal(a.session.isOfflineQueueSessionActive(a.session.getOfflineQueueSession()),false);
 await assert.rejects(a.client.post('/community/posts',{text:'unverified'}),/verification/);
 profile.resolve(user(B));await o.flush();assert.equal(state(o).user.id,B);assert.equal(state(o).token,`token-${B}`);assert.equal(a.auth.user.id,B);
});

test('an interrupted React render cannot expose a new token to the committed old draft',async()=>{
 const {o,a,b}=await pair();await a.mount();await b.mount();const committed=a.tree;
 await b.authStorage.replaceStoredSession(user(B),`token-${B}`);await tick();a.render(false);
 assert.equal(a.tree,committed);assert.equal(a.auth.user.id,A);
 await assert.rejects(a.client.post('/community/posts',{text:'old A draft'}),/Session changed/);
 assert.equal(a.requests.length,0);
 a.render();await a.client.post('/community/posts',{text:'new B intent'});
 assert.equal(a.requests[0].headers.Authorization,`Bearer token-${B}`);
});

test('a stale same-owner token generation cannot dispatch or start guest login from the old UI',async()=>{
 const {o,a,b}=await pair();await a.mount();await b.mount();
 await b.authStorage.replaceStoredSession(user(A),'replacement-token');
 await assert.rejects(a.client.post('/community/posts',{text:'old-token intent'}),/Session changed/);
 await assert.rejects(a.auth.loginAsGuest(),/Session changed/);
 assert.equal(state(o).token,'replacement-token');assert.equal(a.requests.length,0);
 await o.flush();await a.client.post('/community/posts',{text:'fresh intent'});
 assert.equal(a.requests[0].headers.Authorization,'Bearer replacement-token');
});

test('local guest card mutations reload the latest local snapshot and never enqueue backend work',async()=>{
 const o=origin(),a=o.tab(),b=o.tab();await a.install(a.authStorage.localGuestUser,null);
 const first=a.load('utils/localGuestCards.ts'),second=b.load('utils/localGuestCards.ts');
 const card=id=>({_id:id,targetWord:id,nextReviewDate:new Date(0).toISOString(),reviewCount:0});
 await Promise.all([first.mutateLocalGuestCards('English',all=>[card('one'),...all]),second.mutateLocalGuestCards('English',all=>[card('two'),...all])]);
 await Promise.all([first.mutateLocalGuestCards('English',all=>all.map(c=>c._id==='one'?{...c,targetWord:'edited'}:c)),second.mutateLocalGuestCards('English',all=>[card('three'),...all])]);
 const all=JSON.parse(o.values.get('flashcards_all_guest_English'));
 assert.equal(all.length,3);assert.equal(all.find(c=>c._id==='one').targetWord,'edited');
 assert.equal(a.queue.getOfflineQueue().length,0);assert.equal(state(o).token,null);assert.equal(a.requests.length+b.requests.length,0);
 await Promise.all([first.mutateLocalGuestCards('English',all=>all.filter(c=>c._id!=='two')),second.mutateLocalGuestCards('English',all=>all.map(c=>c._id==='one'?{...c,reviewCount:c.reviewCount+1}:c))]);
 assert.equal(JSON.parse(o.values.get('flashcards_all_guest_English')).find(c=>c._id==='one').reviewCount,1);
 await a.install(user(B),`token-${B}`);await assert.rejects(first.mutateLocalGuestCards('English',all=>[]),/Local guest/);
});

test('unsupported browser 401 invalidates this tab without overwriting shared auth or owner data',async()=>{
 const o=origin(),a=o.tab(false),b=o.tab(false);await a.install();await a.mount();await b.mount();
 const persisted=o.values.get('linguaai_session_v1');a.dispatch=async()=>{throw {response:{status:401}};};
 await assert.rejects(a.client.post('/community/posts',{text:'expired-token intent'}));await o.flush();
 assert.equal(a.auth.user,null);assert.equal(o.values.get('linguaai_session_v1'),persisted);
 await assert.rejects(a.client.post('/community/posts',{}, {sessionSnapshot:{...b.session.getOfflineQueueSession()}}),/Session changed/);
 await b.install(user(B),`token-${B}`);await o.flush();assert.equal(a.auth.user.id,B);
});

test('unsupported coordinator does not spin on preserved retryable queue work',async()=>{
 const o=origin(),a=o.tab(false);await a.install();
 o.values.set(ownerKey(owner),JSON.stringify({schemaVersion:2,ownerNamespace:owner,actions:[{id:'kept',ownerNamespace:owner,type:'complete-lesson',payload:completion(),createdAt:new Date().toISOString(),schemaVersion:1}],tempIds:{},startedCreates:[],failedActions:[]}));
 let probes=0;const health={snapshot:()=>({backendReachable:true}),subscribe:()=>()=>{},refresh:async()=>{probes++;}};
 const service=new(a.load('utils/syncCoordinator.ts').SyncCoordinator)(health);service.start();await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(probes,0);assert.equal(a.requests.length,0);assert.equal(a.timers.size,0);service.stop();
});

test('local guest requests cannot inherit caller/default authorization from a previous account',async()=>{
 const o=origin(),a=o.tab();await a.install(a.authStorage.localGuestUser,null);
 await a.client.get('/lessons',{headers:{Authorization:`Bearer token-${A}`,authorization:`Bearer token-${B}`}});
 assert.equal(a.requests[0].headers.Authorization,undefined);assert.equal(a.requests[0].headers.authorization,undefined);
 assert.equal(a.requests[0].sessionSnapshot.token,'');
});

test('conditional profile installation cannot race a newer account, and fails closed without locks',async()=>{
 const {o,a,b}=await pair();await a.mount();await b.mount();const stale=a.auth.updateUser;
 await b.authStorage.replaceStoredSession(user(B),`token-${B}`);
 await assert.rejects(stale({...user(A),name:'old A profile'}),/Session changed/);
 assert.equal(state(o).user.id,B);
 await o.flush();await assert.rejects(a.auth.updateUser({...user(B),isGuest:true}),/Session changed/);
 assert.equal(state(o).isGuest,false);
 const unsupported=o.tab(false);await unsupported.mount();const before=o.values.get('linguaai_session_v1');
 await assert.rejects(unsupported.auth.updateUser({...user(B),name:'asynchronous profile'}),/Web Locks/);
 assert.equal(o.values.get('linguaai_session_v1'),before);
});
