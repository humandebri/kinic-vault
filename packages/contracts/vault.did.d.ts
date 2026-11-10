import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface Activate {
  'normal' : Envelope,
  'vault' : Uint8Array | number[],
  'registration' : [] | [string],
  'assertion' : [] | [string],
  'operation' : Uint8Array | number[],
  'recovery' : Envelope,
}
export interface BeginRestore {
  'count' : bigint,
  'root' : Uint8Array | number[],
  'operation' : Uint8Array | number[],
  'reserved_bytes' : bigint,
  'header' : Header,
}
export interface BeginRevision {
  'object' : Uint8Array | number[],
  'vault' : Uint8Array | number[],
  'chunk_hashes' : Array<Uint8Array | number[]>,
  'operation' : Uint8Array | number[],
  'manifest' : Uint8Array | number[],
  'plain_size' : bigint,
  'expected_revision' : bigint,
}
export interface BeginUnlock {
  'vault' : Uint8Array | number[],
  'transport' : Uint8Array | number[],
  'epoch' : bigint,
  'target' : Uint8Array | number[],
  'purpose' : Purpose,
}
export interface Challenge {
  'expires' : bigint,
  'registration' : boolean,
  'credential_ids' : Array<Uint8Array | number[]>,
  'bytes' : Uint8Array | number[],
}
export interface Config {
  'minimum_cycles' : bigint,
  'owner' : Principal,
  'origin' : string,
  'key_name' : string,
  'rp_id' : string,
}
export interface CredentialInfo { 'id' : Uint8Array | number[] }
export interface Derive {
  'vault' : Uint8Array | number[],
  'transport' : Uint8Array | number[],
  'epoch' : bigint,
  'assertion' : [] | [string],
}
export interface Envelope {
  'ciphertext' : Uint8Array | number[],
  'version' : number,
  'nonce' : Uint8Array | number[],
}
export type Error = { 'Storage' : null } |
  { 'InvalidInput' : null } |
  { 'Busy' : null } |
  { 'InvalidProof' : null } |
  { 'KeyService' : null } |
  { 'NotFound' : null } |
  { 'ExportInProgress' : null } |
  { 'Unauthorized' : null } |
  { 'Expired' : null } |
  { 'QuotaExceeded' : null } |
  { 'Conflict' : null };
export interface Export {
  'id' : Uint8Array | number[],
  'expires' : bigint,
  'vault' : Uint8Array | number[],
  'plain_bytes' : bigint,
  'state' : string,
  'chunk_count' : bigint,
  'sequence' : bigint,
  'record_count' : bigint,
  'header' : Header,
}
export interface ExportPage {
  'next' : [] | [bigint],
  'entries' : Array<Revision>,
}
export interface Header {
  'id' : Uint8Array | number[],
  'normal' : [] | [Envelope],
  'epoch' : bigint,
  'backup_sequence' : [] | [bigint],
  'state' : VaultState,
  'key_name' : string,
  'recovery' : [] | [Envelope],
  'sequence' : bigint,
  'backup_at' : [] | [bigint],
}
export interface KeyReply {
  'encrypted_key' : Uint8Array | number[],
  'public_key' : Uint8Array | number[],
}
export interface ManageCredential {
  'remove' : [] | [Uint8Array | number[]],
  'vault' : Uint8Array | number[],
  'registration' : [] | [string],
  'assertion' : string,
}
export interface ObjectPage {
  'next' : [] | [Uint8Array | number[]],
  'entries' : Array<Revision>,
}
export type Purpose = { 'Unlock' : null } |
  { 'Activate' : null } |
  { 'AddCredential' : null } |
  { 'RemoveCredential' : null };
export interface Quota {
  'reserved' : bigint,
  'limit' : bigint,
  'current' : bigint,
  'charged' : bigint,
}
export interface Reserve {
  'vault' : Uint8Array | number[],
  'operation' : Uint8Array | number[],
}
export interface RestoreProgress {
  'count' : bigint,
  'root' : Uint8Array | number[],
  'sequence' : bigint,
}
export type Result = { 'Ok' : Header } |
  { 'Err' : Error };
export type Result_1 = { 'Ok' : Export } |
  { 'Err' : Error };
export type Result_10 = { 'Ok' : [] | [Export] } |
  { 'Err' : Error };
export type Result_11 = { 'Ok' : Uint8Array | number[] } |
  { 'Err' : Error };
export type Result_12 = { 'Ok' : Quota } |
  { 'Err' : Error };
export type Result_13 = { 'Ok' : Array<CredentialInfo> } |
  { 'Err' : Error };
export type Result_14 = { 'Ok' : ObjectPage } |
  { 'Err' : Error };
export type Result_15 = { 'Ok' : Array<Header> } |
  { 'Err' : Error };
export type Result_2 = { 'Ok' : null } |
  { 'Err' : Error };
export type Result_3 = { 'Ok' : Upload } |
  { 'Err' : Error };
export type Result_4 = { 'Ok' : Challenge } |
  { 'Err' : Error };
export type Result_5 = { 'Ok' : bigint } |
  { 'Err' : Error };
export type Result_6 = { 'Ok' : RestoreProgress } |
  { 'Err' : Error };
export type Result_7 = { 'Ok' : Revision } |
  { 'Err' : Error };
export type Result_8 = { 'Ok' : KeyReply } |
  { 'Err' : Error };
export type Result_9 = { 'Ok' : ExportPage } |
  { 'Err' : Error };
export interface Revision {
  'deleted' : boolean,
  'object' : Uint8Array | number[],
  'vault' : Uint8Array | number[],
  'chunk_hashes' : Array<Uint8Array | number[]>,
  'revision' : bigint,
  'manifest' : Uint8Array | number[],
  'plain_size' : bigint,
  'sequence' : bigint,
}
export interface Upload {
  'id' : Uint8Array | number[],
  'expires' : bigint,
  'revision' : bigint,
}
export type VaultState = { 'Active' : null } |
  { 'Restoring' : null } |
  { 'Pending' : null };
export interface _SERVICE {
  'abort_export' : ActorMethod<[Uint8Array | number[]], Result>,
  'activate_vault' : ActorMethod<[Activate], Result>,
  'begin_export' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[]],
    Result_1
  >,
  'begin_restore' : ActorMethod<[BeginRestore], Result>,
  'begin_restore_revision' : ActorMethod<
    [Uint8Array | number[], Revision],
    Result_2
  >,
  'begin_revision' : ActorMethod<[BeginRevision], Result_3>,
  'begin_unlock' : ActorMethod<[BeginUnlock], Result_4>,
  'collect_garbage' : ActorMethod<[], Result_5>,
  'commit_restore' : ActorMethod<[Activate], Result>,
  'commit_restore_revision' : ActorMethod<
    [Uint8Array | number[], bigint],
    Result_6
  >,
  'commit_revision' : ActorMethod<[Uint8Array | number[]], Result_7>,
  'delete_object' : ActorMethod<
    [
      Uint8Array | number[],
      Uint8Array | number[],
      bigint,
      Uint8Array | number[],
    ],
    Result_7
  >,
  'derive_vault_key' : ActorMethod<[Derive], Result_8>,
  'export_index' : ActorMethod<[Uint8Array | number[], bigint], Result_9>,
  'finish_export' : ActorMethod<[Uint8Array | number[], boolean], Result>,
  'get_active_export' : ActorMethod<[], Result_10>,
  'get_chunk' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[], bigint, number],
    Result_11
  >,
  'get_export_chunk' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[], bigint, number],
    Result_11
  >,
  'get_manifest' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[], bigint],
    Result_7
  >,
  'get_quota' : ActorMethod<[Uint8Array | number[]], Result_12>,
  'get_vault_header' : ActorMethod<[Uint8Array | number[]], Result>,
  'list_credentials' : ActorMethod<[], Result_13>,
  'list_history' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[], bigint],
    Result_9
  >,
  'list_objects' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[]],
    Result_14
  >,
  'list_vaults' : ActorMethod<[], Result_15>,
  'manage_unlock_credential' : ActorMethod<[ManageCredential], Result_2>,
  'prepare_unlock_credential' : ActorMethod<
    [Uint8Array | number[], string],
    Result_11
  >,
  'purge_object' : ActorMethod<
    [Uint8Array | number[], Uint8Array | number[]],
    Result_2
  >,
  'put_chunk' : ActorMethod<
    [Uint8Array | number[], number, Uint8Array | number[]],
    Result_2
  >,
  'put_restore_chunk' : ActorMethod<
    [Uint8Array | number[], number, Uint8Array | number[]],
    Result_2
  >,
  'reserve_vault' : ActorMethod<[Reserve], Result>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
