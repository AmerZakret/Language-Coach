const { readFileSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const tick = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const A='507f1f77bcf86cd799439011', B='507f1f77bcf86cd799439012';
const user = (id=A, guest=false) => ({id,name:id,email:guest ? `${id}@guest.lingua.local` : `${id}@example.com`,isGuest:guest,targetLanguage:'en'});
const ownerKey = owner => `linguaai_offline_queue_${encodeURIComponent(owner)}`;
function origin() {
  const values=new Map(), tabs=[], held=new Map(), waiting=new Map(), writes=[];
  function next(name) {
    if(held.has(name)) return;
    const job=waiting.get(name)?.shift(); if(!job) return;
    held.set(name,job);
    Promise.resolve().then(() => { if(job.tab.closed) throw new Error('Context closed'); return job.work({name,mode:'exclusive'}); })
      .then(job.resolve,job.reject).finally(() => { if(held.get(name)===job) {held.delete(name); next(name);} });
  }
  const shared={values,tabs,writes,held,waiting};
  shared.flush=async () => { for(let i=0;i<8;i++) {await tick(); for(const tab of tabs) if(!tab.closed && tab.dirty) tab.render();} };
  shared.tab=(supported=true) => {
    const tab={id:tabs.length,closed:false,dirty:false,requests:[],listeners:new Set(),timers:new Set()}; tabs.push(tab);
    function alive() {if(tab.closed) throw new Error('Context closed');}
    function notify(key,oldValue,newValue) {
      for(const other of tabs) if(other!==tab && !other.closed) setImmediate(() => {
        if(!other.closed) for(const listener of other.listeners) listener({key,oldValue,newValue,storageArea:other.localStorage});
      });
    }
    tab.localStorage={
      getItem:key => {alive(); return values.get(key)??null;},
      setItem:(key,value) => {
        alive(); value=String(value); const oldValue=values.get(key)??null;
        if(key.startsWith('linguaai_offline_queue_') && !key.endsWith('legacy_unowned')) {
          const owner=decodeURIComponent(key.slice('linguaai_offline_queue_'.length));
          assert.equal(held.get(`linguaai:queue:storage:${encodeURIComponent(owner)}`)?.tab,tab,'Queue write requires this context\'s owner lock');
        }
        if(key==='linguaai_offline_queue_legacy_unowned') assert.equal(held.get('linguaai:queue:legacy')?.tab,tab);
        values.set(key,value); writes.push({tab:tab.id,key,value}); if(oldValue!==value) notify(key,oldValue,value);
      },
      removeItem:key => {alive(); const oldValue=values.get(key)??null; values.delete(key); if(oldValue!==null) notify(key,oldValue,null);},
      get length(){return values.size;},key:index=>[...values.keys()][index]??null,
    };
    tab.window={addEventListener:(type,listener)=>{if(type==='storage')tab.listeners.add(listener);},removeEventListener:(type,listener)=>tab.listeners.delete(listener)};
    const locks={request:(name,options,work)=>{
      alive(); if(typeof options==='function'){work=options;options={};}
      if(options.ifAvailable && (held.has(name)||waiting.get(name)?.length)) return Promise.resolve().then(()=>work(null));
      return new Promise((resolve,reject)=>{const jobs=waiting.get(name)||[];waiting.set(name,jobs);jobs.push({tab,work,resolve,reject});next(name);});
    }};
    tab.navigator=supported?{locks,onLine:true}:{onLine:true};
    const slots=[],effects=[],layouts=[];let cursor=0;
    const react={
      createContext:()=>({Provider:Symbol('provider')}),Fragment:Symbol('fragment'),
      useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
        return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;tab.dirty=true;}];},
      useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
      useLayoutEffect:callback=>{layouts.push(callback);},
      useEffect:callback=>{const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(callback);}},
      createElement:(type,props,...children)=>({type,props:{...props,children:children.length===1?children[0]:children}}),
    };
    const requestInterceptors=[],responseInterceptors=[];
    tab.dispatch=async req=>req.url.includes('complete-lesson')?{data:{data:{progressEpoch:req.data.progressEpoch}}}
      : req.url.startsWith('/progress/') && req.method==='delete'?{data:{progressEpoch:req.data.expectedEpoch+1}}
      : {data:{_id:`server-${req.headers['X-Idempotency-Key']}`}};
    const transport={interceptors:{request:{use:fn=>requestInterceptors.push(fn)},response:{use:(success,failure)=>responseInterceptors.push({success,failure})}}};
    function request(method,url,data,config={}) {
      let pending=Promise.resolve({...config,method,url,data,headers:{...config.headers}});
      if(tab.beforeDispatch) pending=pending.then(async req=>{await tab.beforeDispatch();return req;});
      for(const interceptor of requestInterceptors)pending=pending.then(interceptor);
      pending=pending.then(req=>{alive();tab.requests.push(req);return Promise.resolve(tab.dispatch(req)).catch(error=>{error.config??=req;throw error;});});
      for(const {success,failure} of responseInterceptors)pending=pending.then(success,failure);
      return pending;
    }
    for(const method of ['get','delete','head','options'])transport[method]=(url,config)=>request(method,url,config?.data,config);
    for(const method of ['post','put','patch'])transport[method]=(url,data,config)=>request(method,url,data,config);
    const modules=new Map();
    tab.load=file=>{
      const full=resolve(__dirname,'../../src',file);
      if(modules.has(full))return modules.get(full).exports;
      const module={exports:{}};modules.set(full,module);
      const code=readFileSync(full,'utf8').replaceAll('import.meta.env.VITE_API_URL','undefined');
      const compiled=ts.transpileModule(code,{fileName:full,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
      vm.runInNewContext(compiled,{module,exports:module.exports,localStorage:tab.localStorage,navigator:tab.navigator,window:tab.window,
        AbortController,Date,console:{error(){},log(){}},fetch:()=>tab.fetchGuest(),
        setTimeout:(fn,ms)=>{const timer=setTimeout(()=>{tab.timers.delete(timer);if(!tab.closed)fn();},ms);tab.timers.add(timer);return timer;},
        clearTimeout:timer=>{clearTimeout(timer);tab.timers.delete(timer);},
        require:path=>{
          if(path==='react')return react;
          if(path==='axios')return {create:()=>transport};
          if(full.endsWith('AuthContext.tsx') && path==='../api/authApi')return {fetchMe:()=>tab.fetchMe()};
          let target=resolve(dirname(full),path)+'.ts'; if(path.endsWith('AuthContext'))target+='x';
          return tab.load(target);
        }});
      return module.exports;
    };
    tab.fetchMe=async()=>{throw new Error('Offline profile');};tab.fetchGuest=async()=>{throw new Error('Offline guest');};
    tab.authStorage=tab.load('utils/authSessionStorage.ts');tab.session=tab.load('utils/queueSession.ts');
    tab.queue=tab.load('utils/offlineQueue.ts');tab.client=tab.load('api/apiClient.ts').default;
    tab.render=(commit=true)=>{alive();cursor=0;tab.dirty=false;const tree=tab.load('context/AuthContext.tsx').AuthProvider({children:'old-session draft'});if(!commit){layouts.splice(0);return;}tab.tree=tree;tab.auth=tab.tree.props.value;for(const layout of layouts.splice(0))layout();for(const effect of effects.splice(0))effect();return tab.auth;};
    tab.mount=async()=>{tab.render();await shared.flush();};
    tab.install=async(u=user(),token=`token-${u.id}`)=>{await tab.authStorage.replaceStoredSession(u,token);if(tab.tree)await shared.flush();else tab.session.observeRenderedSession(tab.authStorage.readStoredSession());};
    tab.close=()=>{
      tab.closed=true;tab.listeners.clear();for(const timer of tab.timers)clearTimeout(timer);tab.timers.clear();
      for(const [name,jobs]of waiting) {waiting.set(name,jobs.filter(job=>{if(job.tab===tab){job.reject(new Error('Context closed'));return false;}return true;}));}
      for(const [name,job]of [...held])if(job.tab===tab){held.delete(name);job.reject(new Error('Context closed'));next(name);}
    };
    return tab;
  };
  return shared;
}
module.exports={origin,A,B,user,ownerKey,tick,deferred};
