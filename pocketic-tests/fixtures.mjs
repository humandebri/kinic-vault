import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
export const b64=b=>Buffer.from(b).toString('base64url');
export const digest=b=>createHash('sha256').update(b).digest();
export const id=()=>new Uint8Array(randomBytes(16));
export const ok=result=>{if(!('Ok'in result))throw Error(JSON.stringify(result));return result.Ok};
const uint=(major,n)=>n<24?Buffer.from([major*32+n]):n<256?Buffer.from([major*32+24,n]):Buffer.from([major*32+25,n>>8,n&255]);
function cbor(x){if(typeof x==='number')return x>=0?uint(0,x):uint(1,-1-x);if(typeof x==='string'){let b=Buffer.from(x);return Buffer.concat([uint(3,b.length),b])}if(Buffer.isBuffer(x)||x instanceof Uint8Array)return Buffer.concat([uint(2,x.length),Buffer.from(x)]);if(x instanceof Map)return Buffer.concat([uint(5,x.size),...[...x].flatMap(([k,v])=>[cbor(k),cbor(v)])]);throw Error('fixture type')}
export function passkey(){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');const raw=publicKey.export({format:'jwk'});const credential=id();
 const cose=cbor(new Map([[1,1],[3,-8],[-1,6],[-2,Buffer.from(raw.x,'base64url')]]));
 const client=(ch,kind,origin)=>Buffer.from(JSON.stringify({type:kind,challenge:b64(ch.bytes),origin,crossOrigin:false}));
 return {credential,
 registration(ch,{origin='http://localhost:5173',flags=0x45,rp='localhost'}={}){
  const data=Buffer.concat([digest(Buffer.from(rp)),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,credential.length]),Buffer.from(credential),cose]);
  return JSON.stringify({id:b64(credential),transports:['internal'],clientDataJSON:b64(client(ch,'webauthn.create',origin)),attestationObject:b64(cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',data]])))});
 },
 assertion(ch,{origin='http://localhost:5173',flags=5,rp='localhost',challenge=ch.bytes}={}){
  const data=Buffer.concat([digest(Buffer.from(rp)),Buffer.from([flags]),Buffer.alloc(4)]);
  const cd=client({...ch,bytes:challenge},'webauthn.get',origin);
  return JSON.stringify({id:b64(credential),authenticatorData:b64(data),clientDataJSON:b64(cd),signature:b64(sign(null,Buffer.concat([data,digest(cd)]),privateKey))});
 }};
}
