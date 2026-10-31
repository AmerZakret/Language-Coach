const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<!doctype html><body></body>',{url:'https://app.example.invalid'});
global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(fetch){
  const revoked=[],created=[];class ImageURL extends URL{static createObjectURL(blob){const value='blob:synthetic-'+created.length;created.push(blob);return value;}static revokeObjectURL(url){revoked.push(url);}}
  const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/components/CommunityImage.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require,URL:ImageURL,Blob,AbortController,fetch});
  const container=document.createElement('div'),root=createRoot(container);
  const render=async(props={})=>React.act(async()=>{root.render(React.createElement(module.exports.CommunityImage,{src:'https://api.example.invalid/uploads/community/fixture.png',baseUrl:'https://api.example.invalid',token:'synthetic-owner-A',...props}));await tick();});
  return{container,root,render,created,revoked,close:()=>React.act(async()=>root.unmount())};
}
test('authenticated image read stays on API origin and revokes its session-local blob',async()=>{
  const calls=[],f=fixture(async(url,options)=>{calls.push({url:String(url),options});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})});
  try{await f.render();assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-owner-A');assert.equal(calls[0].options.credentials,'omit');assert.equal(f.container.querySelector('img').getAttribute('src'),'blob:synthetic-0');}
  finally{await f.close();}assert.deepEqual(f.revoked,['blob:synthetic-0']);
});
test('foreign origin, credentialed URL, missing token and unrelated route never receive a bearer',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;throw Error('unexpected network');});
  try{for(const props of [{src:'https://foreign.example/uploads/community/fixture.png'},{src:'https://user:password@api.example.invalid/uploads/community/fixture.png'},{src:'https://api.example.invalid/auth/login'},{token:null}])await f.render(props);assert.equal(calls,0);assert.equal(f.container.querySelector('img'),null);}finally{await f.close();}
});
test('session replacement hides prior image and discards delayed prior response',async()=>{
  let release;const waiting=new Promise(r=>release=r),f=fixture(async()=>waiting);
  try{await f.render();await f.render({token:null});release(new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));await React.act(async()=>tick());assert.equal(f.created.length,0);assert.equal(f.container.querySelector('img'),null);}finally{await f.close();}
});
test('oversized authenticated response never allocates an image blob',async()=>{
  const f=fixture(async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/png'}}));try{await f.render();assert.equal(f.created.length,0);assert.equal(f.container.querySelector('img'),null);}finally{await f.close();}
});
