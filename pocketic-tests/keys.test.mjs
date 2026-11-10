import assert from 'node:assert/strict';
import test from 'node:test';
import {PocketIc,PocketIcServer} from '@dfinity/pic';
import {IDL} from '@icp-sdk/core/candid';
import {Principal} from '@icp-sdk/core/principal';
import {TransportSecretKey,EncryptedVetKey,MasterPublicKey,PocketIcMasterPublicKeyId} from '@icp-sdk/vetkeys';
import {verifiedKEK,seal,open,randomBytes,importKey,aad} from '../packages/crypto/src/index.ts';
import {idlFactory,init} from '../packages/contracts/vault.did.js';
import {id,ok,passkey} from './fixtures.mjs';
const owner=Principal.selfAuthenticating(new Uint8Array(32).fill(31));
const outsider=Principal.selfAuthenticating(new Uint8Array(32).fill(32));
const wasm=new URL('../target/wasm32-unknown-unknown/release/vault_canister.wasm',import.meta.url).pathname;
const cfg={owner,origin:'http://localhost:5173',rp_id:'localhost',key_name:'test_key_1',minimum_cycles:100_000_000_000n};
const zero=new Uint8Array(48);
const envelope=()=>({version:1,nonce:randomBytes(12),ciphertext:randomBytes(48)});
async function fixture(f,initialWasm=wasm){const server=await PocketIcServer.start({showCanisterLogs:true});let pic;try{
 pic=await PocketIc.create(server.getUrl(),{fiduciary:{state:{type:"new"}},icpConfig:{betaFeatures:'Enabled'}});
 const {actor,canisterId}=await pic.setupCanister({sender:owner,idlFactory,wasm:initialWasm,arg:IDL.encode(init({IDL}),[cfg]),cycles:10_000_000_000_000n});actor.setPrincipal(owner);
 await f({pic,actor,canisterId});
}finally{if(pic)await pic.tearDown();await server.stop()}}
const begin=(actor,vault,purpose,transport=zero,target=[])=>actor.begin_unlock({vault,epoch:0n,purpose:{[purpose]:null},transport,target});
test('real Wasm: registration, fresh UV, vetKD, replay, corruption, outsider and upgrade',()=>fixture(async({pic,actor,canisterId})=>{
 const vault=id(),operation=id(),key=passkey();
 actor.setPrincipal(outsider);assert.ok('Unauthorized'in (await actor.reserve_vault({vault,operation})).Err);
 actor.setPrincipal(Principal.anonymous());assert.ok('Err'in await actor.derive_vault_key({vault,epoch:0n,transport:zero,assertion:[]}));
 actor.setPrincipal(owner);ok(await actor.reserve_vault({vault,operation}));
 assert.ok('Err'in await actor.get_vault_header(vault));
 const transport=TransportSecretKey.random();
 const first=ok(await actor.derive_vault_key({vault,epoch:0n,transport:transport.publicKeyBytes(),assertion:[]}));
 const kek=await verifiedKEK(first.encrypted_key,transport,canisterId.toText(),vault,0n,true);
 const vrk=randomBytes(32),binding=aad(vault,new Uint8Array(16),0n,'normal');
 const normal=await seal(kek,vrk,binding),recovery=envelope();
 const ch=ok(await begin(actor,vault,'Activate'));
 const req={vault,operation:id(),normal,recovery,registration:[key.registration(ch)],assertion:[]};
 const header=ok(await actor.activate_vault(req));assert.ok('Active'in header.state);
 assert.deepEqual(ok(await actor.activate_vault(req)),header);
 assert.ok('Err'in await actor.activate_vault({...req,recovery:envelope()}));
 assert.ok('Err'in await actor.derive_vault_key({vault,epoch:0n,transport:transport.publicKeyBytes(),assertion:[]}));
 const next=TransportSecretKey.random();const challenge=ok(await begin(actor,vault,'Unlock',next.publicKeyBytes()));
 for(const bad of [key.assertion(challenge,{flags:1}),key.assertion(challenge,{origin:'http://evil.invalid'}),key.assertion(challenge,{rp:'evil.invalid'}),key.assertion(challenge,{challenge:randomBytes(32)})]){
  assert.ok('Err'in await actor.derive_vault_key({vault,epoch:0n,transport:next.publicKeyBytes(),assertion:[bad]}));
 }
 const assertion=key.assertion(challenge);
 const derived=ok(await actor.derive_vault_key({vault,epoch:0n,transport:next.publicKeyBytes(),assertion:[assertion]}));
 const same=await verifiedKEK(derived.encrypted_key,next,canisterId.toText(),vault,0n,true);
 assert.deepEqual(await open(same,normal,binding),vrk);
 assert.ok('Err'in await actor.derive_vault_key({vault,epoch:0n,transport:next.publicKeyBytes(),assertion:[assertion]}));
 assert.throws(()=>verifiedKEK(derived.encrypted_key,next,canisterId.toText(),vault,1n,true));
 assert.throws(()=>verifiedKEK(derived.encrypted_key,next,canisterId.toText(),new Uint8Array(16),0n,true));
 assert.throws(()=>verifiedKEK(derived.encrypted_key,next,outsider.toText(),vault,0n,true));
 assert.throws(()=>verifiedKEK(derived.encrypted_key,next,canisterId.toText(),vault,0n,false));
 const wrongContext=MasterPublicKey.pocketicKey(PocketIcMasterPublicKeyId.TEST_KEY_1).deriveCanisterKey(canisterId.toUint8Array()).deriveSubKey(new TextEncoder().encode('wrong-context'));
 assert.throws(()=>EncryptedVetKey.deserialize(derived.encrypted_key).decryptAndVerify(next,wrongContext,new Uint8Array([...vault,...new Uint8Array(8)])));

 actor.setPrincipal(outsider);assert.ok('Err'in await actor.get_vault_header(vault));actor.setPrincipal(owner);
 await pic.upgradeCanister({sender:owner,canisterId,wasm,arg:IDL.encode([],[])});
 assert.deepEqual(ok(await actor.get_vault_header(vault)),header);
 // A synced passkey whose counter is always zero remains usable after upgrade.
 const c=ok(await begin(actor,vault,'Unlock',next.publicKeyBytes()));ok(await actor.derive_vault_key({vault,epoch:0n,transport:next.publicKeyBytes(),assertion:[key.assertion(c)]}));
 const remove=ok(await begin(actor,vault,'RemoveCredential',zero,key.credential));assert.ok('Conflict'in (await actor.manage_unlock_credential({vault,remove:[key.credential],registration:[],assertion:key.assertion(remove)})).Err);
 await pic.advanceTime(121000);
 const extra=passkey(),regCh=ok(await begin(actor,vault,'AddCredential')),registration=extra.registration(regCh);
 const target=ok(await actor.prepare_unlock_credential(vault,registration));
 const addCh=ok(await begin(actor,vault,'AddCredential',zero,target));ok(await actor.manage_unlock_credential({vault,remove:[],registration:[registration],assertion:key.assertion(addCh)}));assert.equal(ok(await actor.list_credentials()).length,2);
 const delCh=ok(await begin(actor,vault,'RemoveCredential',zero,key.credential));ok(await actor.manage_unlock_credential({vault,remove:[key.credential],registration:[],assertion:key.assertion(delCh)}));assert.equal(ok(await actor.list_credentials()).length,1);

},new URL('../target/vault-schema-v3.wasm',import.meta.url).pathname));
test('real Wasm: pending expiry and stale activation preserve state',()=>fixture(async({pic,actor})=>{
 const vault=id();ok(await actor.reserve_vault({vault,operation:id()}));const key=passkey();const ch=ok(await begin(actor,vault,'Activate'));
 await pic.advanceTime(121_000);
 assert.ok('Err'in await actor.activate_vault({vault,operation:id(),normal:envelope(),recovery:envelope(),registration:[key.registration(ch)],assertion:[]}));
 await pic.advanceTime(86_400_000);
 assert.ok('Err'in await actor.derive_vault_key({vault,epoch:0n,transport:TransportSecretKey.random().publicKeyBytes(),assertion:[]}));
}));
test('real Wasm: chunk retry, atomic commit, export retention, quota and upgrade',()=>fixture(async({pic,actor,canisterId})=>{
 const vault=id(),key=passkey();ok(await actor.reserve_vault({vault,operation:id()}));const ch=ok(await begin(actor,vault,'Activate'));
 ok(await actor.activate_vault({vault,operation:id(),normal:envelope(),recovery:envelope(),registration:[key.registration(ch)],assertion:[]}));
 const object=id(),operation=id(),chunks=[randomBytes(1048576+16),randomBytes(1+16)];
 const hashes=await Promise.all(chunks.map(async c=>new Uint8Array(await crypto.subtle.digest('SHA-256',c))));
 const request={vault,object,expected_revision:0n,operation,plain_size:1048577n,manifest:new Uint8Array([1,2,3]),chunk_hashes:hashes};
 ok(await actor.begin_revision(request));
 assert.ok('Err'in await actor.begin_revision({...request,operation:id()}));
 assert.ok('Err'in await actor.commit_revision(operation));
 assert.deepEqual(await actor.purge_object(vault,object),{Err:{Busy:null}});
 for(let i=0;i<2;i++){ok(await actor.put_chunk(operation,i,chunks[i]));ok(await actor.put_chunk(operation,i,chunks[i]));}
 const bad=new Uint8Array(chunks[0]);bad[0]^=1;assert.ok('Err'in await actor.put_chunk(operation,0,bad));
 const revision=ok(await actor.commit_revision(operation));assert.equal(revision.revision,1n);
 assert.deepEqual(ok(await actor.commit_revision(operation)),revision);
 assert.equal(ok(await actor.get_quota(vault)).current,1048577n);
 assert.deepEqual(ok(await actor.get_chunk(vault,object,1n,0)),chunks[0]);
 const exp=ok(await actor.begin_export(vault,id()));
 ok(await actor.delete_object(vault,object,1n,id()));assert.ok('Err'in await actor.purge_object(vault,object));
 assert.equal(ok(await actor.export_index(exp.id,0n)).entries.length,1);
 assert.deepEqual(ok(await actor.get_export_chunk(exp.id,object,1n,1)),chunks[1]);
 const saved=ok(await actor.finish_export(exp.id,true));assert.ok(saved.sequence>saved.backup_sequence[0]);
 await pic.upgradeCanister({sender:owner,canisterId,wasm,arg:IDL.encode([],[])});
 assert.equal(ok(await actor.get_manifest(vault,object,0n)).deleted,true);
 assert.deepEqual(ok(await actor.get_chunk(vault,object,1n,0)),chunks[0]);
 assert.ok('Err'in await actor.begin_revision({...request,object:id(),operation:id(),plain_size:10485761n}));
 actor.setPrincipal(outsider);assert.ok('Err'in await actor.get_chunk(vault,object,1n,0));
}));
test('real Wasm: restore to another canister and owner preserves all ciphertext and rejects the old owner',()=>fixture(async({pic,actor,canisterId})=>{
 const {encryptDocument,pack,b64}=await import('../packages/crypto/src/documents.ts');
 const {restoreRoot}=await import('../packages/backup/src/index.ts');
 const vault=id(),object=id(),rootRaw=randomBytes(32),root=await importKey(rootRaw),sourceKey=passkey();
 ok(await actor.reserve_vault({vault,operation:id()}));const t=TransportSecretKey.random();const derived=ok(await actor.derive_vault_key({vault,epoch:0n,transport:t.publicKeyBytes(),assertion:[]}));const kek=await verifiedKEK(derived.encrypted_key,t,canisterId.toText(),vault,0n,true);
 const normal=await seal(kek,rootRaw,aad(vault,new Uint8Array(16),0n,'normal')),recovery=envelope();const c=ok(await begin(actor,vault,'Activate'));
 ok(await actor.activate_vault({vault,operation:id(),normal,recovery,registration:[sourceKey.registration(c)],assertion:[]}));
 const doc=await encryptDocument(root,vault,object,1n,{kind:'note',title:'Synthetic restore'},new TextEncoder().encode('synthetic portable content'));
 const op=id();ok(await actor.begin_revision({vault,object,expected_revision:0n,operation:op,plain_size:26n,manifest:doc.manifest,chunk_hashes:doc.hashes}));ok(await actor.put_chunk(op,0,doc.chunks[0]));const rev=ok(await actor.commit_revision(op));const header=ok(await actor.get_vault_header(vault));
 const portable={vault:b64(vault),object:b64(object),revision:String(rev.revision),sequence:String(rev.sequence),plain_size:String(rev.plain_size),manifest:b64(doc.manifest),hashes:doc.hashes.map(b64),deleted:false};
 const {actor:dest,canisterId:destId}=await pic.setupCanister({sender:owner,idlFactory,wasm,arg:IDL.encode(init({IDL}),[{...cfg,owner:outsider}]),cycles:10_000_000_000_000n});dest.setPrincipal(outsider);
 ok(await dest.begin_restore({header,operation:id(),count:1n,root:await restoreRoot([portable]),reserved_bytes:1048576n}));assert.ok('Err'in await dest.get_vault_header(vault));
 const incomplete={vault,operation:id(),normal:envelope(),recovery,registration:[],assertion:[]};assert.ok('Err'in await dest.activate_vault(incomplete));assert.ok('Err'in await dest.commit_restore(incomplete));
 ok(await dest.begin_restore_revision(vault,rev));assert.ok('Err'in await dest.commit_restore_revision(vault,rev.sequence));ok(await dest.put_restore_chunk(vault,0,doc.chunks[0]));ok(await dest.commit_restore_revision(vault,rev.sequence));
 const dt=TransportSecretKey.random();const dr=ok(await dest.derive_vault_key({vault,epoch:0n,transport:dt.publicKeyBytes(),assertion:[]}));const dk=await verifiedKEK(dr.encrypted_key,dt,destId.toText(),vault,0n,true);
 const nextNormal=await seal(dk,rootRaw,aad(vault,new Uint8Array(16),0n,'normal'));const destKey=passkey(),dch=ok(await begin(dest,vault,'Activate'));const request={vault,operation:id(),normal:nextNormal,recovery,registration:[destKey.registration(dch)],assertion:[]};const restored=ok(await dest.commit_restore(request));assert.equal(restored.backup_sequence.length,0);assert.equal(restored.sequence,header.sequence);assert.deepEqual(ok(await dest.commit_restore(request)),restored);
 assert.deepEqual(ok(await dest.get_manifest(vault,object,1n)).manifest,doc.manifest);assert.deepEqual(ok(await dest.get_chunk(vault,object,1n,0)),doc.chunks[0]);assert.notDeepEqual(restored.normal,header.normal);
 dest.setPrincipal(owner);assert.ok('Err'in await dest.get_vault_header(vault));
}));
