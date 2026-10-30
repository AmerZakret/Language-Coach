const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, validateManifest, validateCompose } = require('./validate-staging-deployment.cjs');
const base = path.resolve(__dirname, '../deployment/staging');
const manifest = () => JSON.parse(fs.readFileSync(path.join(base, 'manifest.example.json')));
const compose = () => JSON.parse(fs.readFileSync(path.join(base, 'compose.json')));

test('11B-B static staging topology agrees and remains explicitly unprovisioned', () => {
  assert.deepEqual(validate(), {
    status: 'STATIC_STAGING_CONTRACT_VALID', environment: 'staging', backendInstances: 1,
    externalTimelineControl: 'DURABLE_POSTGRESQL_C1', artifactDigestsPending: true,
    liveInfrastructureVerified: false,
  });
  assert.throws(() => validate(true), /actual artifact digests/);
  assert.deepEqual(validate(false, path.join(base, 'manifest.example.json'), 'phase11b-local'), validate());
  assert.throws(() => validate(false, path.join(base, 'manifest.example.json'), 'different-build'), /build identity/);
  assert.throws(() => validate(false, path.join(base, 'manifest.example.json'), 'phase11b-local', '11111111-1111-4111-8111-111111111111'), /timeline does not match/);
});

test('C1 rejects missing authority, shared Mongo volume, public control port and legacy fallback', () => {
  const absent=manifest(); delete absent.authority;
  assert.throws(()=>validateManifest(absent), /authority manifest/);
  const publicStore=compose(); publicStore.services.authority.ports=['5432:5432'];
  assert.throws(()=>validateCompose(publicStore,manifest()), /private independent/);
  const rollback=compose(); rollback.services.authority.volumes=['mongo-data:/var/lib/postgresql/data'];
  assert.throws(()=>validateCompose(rollback,manifest()), /independent authority/);
  const legacy=compose(); legacy.services.backend.environment.TIMELINE_AUTHORITY_MODE='LEGACY_LOCAL';
  assert.throws(()=>validateCompose(legacy,manifest()), /durable backend/);
  const leaked=manifest();leaked.note=['postgresql://','synthetic',':synthetic','@authority:5432/test'].join('');
  assert.throws(()=>validateManifest(leaked), /credentialed authority URI/);
});

test('manifest rejects production identity, invalid timeline, secret fields and public local endpoints', () => {
  const wrongEnvironment = manifest(); wrongEnvironment.environment = 'production';
  assert.throws(() => validateManifest(wrongEnvironment), /staging schema/);
  const wrongTimeline = manifest(); wrongTimeline.dataTimelineId = 'not-a-uuid';
  assert.throws(() => validateManifest(wrongTimeline), /timeline or protocol/);
  const secretField = manifest(); secretField.JWT_SECRET = 'CHANGE_ME';
  assert.throws(() => validateManifest(secretField), /secret\/config field/);
  const nestedSecret = manifest(); nestedSecret.pronunciation.serviceToken = 'CHANGE_ME';
  assert.throws(() => validateManifest(nestedSecret), /secret\/config field/);
  const localEndpoint = manifest(); localEndpoint.ingress.apiUrl = 'http://localhost:3000';
  assert.throws(() => validateManifest(localEndpoint), /public endpoint/);
});

test('compose refuses extra backend replicas, public private services and trust-proxy drift', () => {
  const m = manifest();
  const scaled = compose(); scaled.services.backend.deploy.replicas = 2;
  assert.throws(() => validateCompose(scaled, m), /scale fixed at one/);
  const exposed = compose(); exposed.services.mongo.ports = ['27017:27017'];
  assert.throws(() => validateCompose(exposed, m), /only ingress/);
  const routed = compose(); routed.services.pronunciation.networks.push('frontend');
  assert.throws(() => validateCompose(routed, m), /private service exposed/);
  const proxy = compose(); proxy.services.backend.environment.TRUST_PROXY = '172.30.50.0/24';
  assert.throws(() => validateCompose(proxy, m), /trusted proxy address drift/);
  const redirectedMongo = compose(); redirectedMongo.services.backend.environment.MONGODB_URI = '${STAGING_MONGODB_URI}';
  assert.throws(() => validateCompose(redirectedMongo, m), /fixed to disposable/);
  const extra = compose(); extra.services.debug = { image: 'busybox', ports: ['0.0.0.0:27017:27017'] };
  assert.throws(() => validateCompose(extra, m), /service inventory/);
});

test('disposable index bootstrap rejects non-local targets before connecting', () => {
  const { validateTarget } = require('../deployment/staging/bootstrap-indexes.cjs');
  const synthetic = { STAGING_BOOTSTRAP: 'I_ACKNOWLEDGE_DISPOSABLE_STAGING',
    TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED', STAGING_AUTHORITY_BOOTSTRAP: 'I_ACKNOWLEDGE_NEW_EMPTY_ENVIRONMENT',
    AUTHORITY_OPERATOR_INTENT: 'I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY',
    AUTHORITY_OPERATOR_URL: ['postgresql://','timeline_operator',':','a'.repeat(64),'@authority:5432/timeline_authority'].join(''),
    DATA_TIMELINE_ID: manifest().dataTimelineId,
    MONGODB_URI: 'mongodb://mongo:27017/lingua_staging?replicaSet=staging-rs' };
  assert.equal(validateTarget(synthetic), synthetic.MONGODB_URI);
  assert.throws(() => validateTarget({ ...synthetic, STAGING_BOOTSTRAP: 'disabled' }), /acknowledgement/);
  assert.throws(() => validateTarget({ ...synthetic, STAGING_AUTHORITY_BOOTSTRAP: 'disabled' }), /new empty/);
  assert.throws(() => validateTarget({ ...synthetic, AUTHORITY_OPERATOR_URL: undefined }), /operator target/);
  assert.throws(() => validateTarget({ ...synthetic, TIMELINE_AUTHORITY_MODE: 'LEGACY_LOCAL' }), /new empty/);
  assert.throws(() => validateTarget({ ...synthetic, MONGODB_URI: 'mongodb+srv://cluster.example/production' }), /restricted/);
  assert.throws(() => validateTarget({ ...synthetic, MONGODB_URI: 'mongodb://mongo:27017/production?replicaSet=staging-rs' }), /restricted/);
});

test('R2 requires durable effect fencing and verifiable stopped writers before isolation receipts', () => {
  const old=manifest();delete old.authority.fileEffectFencing;
  assert.throws(()=>validateManifest(old), /authority manifest/);
  const {validateInventory}=require('../deployment/staging/verify-file-isolation.cjs');
  const project='language-coach-c1-r2-validation';
  const store=(service,id,image,destination,volume)=>({Id:id,Config:{Image:image,Labels:{'com.docker.compose.project':project,'com.docker.compose.service':service}},State:{Running:true},HostConfig:{PortBindings:{},RestartPolicy:{Name:'no'}},Mounts:[{Destination:destination,Name:project+'_'+volume}]});
  const mongo=store('mongo','m','mongo:7.0.45-jammy','/data/db','mongo-data'),authority=store('authority','p','postgres:17.9-bookworm','/var/lib/postgresql/data','authority-data');
  const backend={Id:'b',Config:{Labels:{'com.docker.compose.project':project,'com.docker.compose.service':'backend'}},State:{Running:false},HostConfig:{RestartPolicy:{Name:'no'}}};
  const networks=[{Name:project+'_control',Internal:true,Containers:{p:{}}},{Name:project+'_database',Internal:true,Containers:{m:{}}}];
  assert.equal(validateInventory(project,[mongo,authority,backend],networks).mongo.Id,'m');
  const running=structuredClone(backend);running.State.Running=true;
  assert.throws(()=>validateInventory(project,[mongo,authority,running],networks), /WRITER_NOT_STOPPED/);
  const restart=structuredClone(backend);restart.HostConfig.RestartPolicy.Name='always';
  assert.throws(()=>validateInventory(project,[mongo,authority,restart],networks), /RESTART_ENABLED/);
  const attached=structuredClone(networks);attached[0].Containers.unknown={};
  assert.throws(()=>validateInventory(project,[mongo,authority,backend],attached), /UNISOLATED/);
  assert.throws(()=>validateInventory('production',[mongo,authority],networks), /DISPOSABLE/);
});
