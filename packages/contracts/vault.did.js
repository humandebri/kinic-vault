export const idlFactory = ({ IDL }) => {
  const Config = IDL.Record({
    'minimum_cycles' : IDL.Nat64,
    'owner' : IDL.Principal,
    'origin' : IDL.Text,
    'key_name' : IDL.Text,
    'rp_id' : IDL.Text,
  });
  const Envelope = IDL.Record({
    'ciphertext' : IDL.Vec(IDL.Nat8),
    'version' : IDL.Nat8,
    'nonce' : IDL.Vec(IDL.Nat8),
  });
  const VaultState = IDL.Variant({
    'Active' : IDL.Null,
    'Restoring' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const Header = IDL.Record({
    'id' : IDL.Vec(IDL.Nat8),
    'normal' : IDL.Opt(Envelope),
    'epoch' : IDL.Nat64,
    'backup_sequence' : IDL.Opt(IDL.Nat64),
    'state' : VaultState,
    'key_name' : IDL.Text,
    'recovery' : IDL.Opt(Envelope),
    'sequence' : IDL.Nat64,
    'backup_at' : IDL.Opt(IDL.Nat64),
  });
  const Error = IDL.Variant({
    'Storage' : IDL.Null,
    'InvalidInput' : IDL.Null,
    'Busy' : IDL.Null,
    'InvalidProof' : IDL.Null,
    'KeyService' : IDL.Null,
    'NotFound' : IDL.Null,
    'ExportInProgress' : IDL.Null,
    'Unauthorized' : IDL.Null,
    'Expired' : IDL.Null,
    'QuotaExceeded' : IDL.Null,
    'Conflict' : IDL.Null,
  });
  const Result = IDL.Variant({ 'Ok' : Header, 'Err' : Error });
  const Activate = IDL.Record({
    'normal' : Envelope,
    'vault' : IDL.Vec(IDL.Nat8),
    'registration' : IDL.Opt(IDL.Text),
    'assertion' : IDL.Opt(IDL.Text),
    'operation' : IDL.Vec(IDL.Nat8),
    'recovery' : Envelope,
  });
  const Export = IDL.Record({
    'id' : IDL.Vec(IDL.Nat8),
    'expires' : IDL.Nat64,
    'vault' : IDL.Vec(IDL.Nat8),
    'plain_bytes' : IDL.Nat64,
    'state' : IDL.Text,
    'chunk_count' : IDL.Nat64,
    'sequence' : IDL.Nat64,
    'record_count' : IDL.Nat64,
    'header' : Header,
  });
  const Result_1 = IDL.Variant({ 'Ok' : Export, 'Err' : Error });
  const BeginRestore = IDL.Record({
    'count' : IDL.Nat64,
    'root' : IDL.Vec(IDL.Nat8),
    'operation' : IDL.Vec(IDL.Nat8),
    'reserved_bytes' : IDL.Nat64,
    'header' : Header,
  });
  const Revision = IDL.Record({
    'deleted' : IDL.Bool,
    'object' : IDL.Vec(IDL.Nat8),
    'vault' : IDL.Vec(IDL.Nat8),
    'chunk_hashes' : IDL.Vec(IDL.Vec(IDL.Nat8)),
    'revision' : IDL.Nat64,
    'manifest' : IDL.Vec(IDL.Nat8),
    'plain_size' : IDL.Nat64,
    'sequence' : IDL.Nat64,
  });
  const Result_2 = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : Error });
  const BeginRevision = IDL.Record({
    'object' : IDL.Vec(IDL.Nat8),
    'vault' : IDL.Vec(IDL.Nat8),
    'chunk_hashes' : IDL.Vec(IDL.Vec(IDL.Nat8)),
    'operation' : IDL.Vec(IDL.Nat8),
    'manifest' : IDL.Vec(IDL.Nat8),
    'plain_size' : IDL.Nat64,
    'expected_revision' : IDL.Nat64,
  });
  const Upload = IDL.Record({
    'id' : IDL.Vec(IDL.Nat8),
    'expires' : IDL.Nat64,
    'revision' : IDL.Nat64,
  });
  const Result_3 = IDL.Variant({ 'Ok' : Upload, 'Err' : Error });
  const Purpose = IDL.Variant({
    'Unlock' : IDL.Null,
    'Activate' : IDL.Null,
    'AddCredential' : IDL.Null,
    'RemoveCredential' : IDL.Null,
  });
  const BeginUnlock = IDL.Record({
    'vault' : IDL.Vec(IDL.Nat8),
    'transport' : IDL.Vec(IDL.Nat8),
    'epoch' : IDL.Nat64,
    'target' : IDL.Vec(IDL.Nat8),
    'purpose' : Purpose,
  });
  const Challenge = IDL.Record({
    'expires' : IDL.Nat64,
    'registration' : IDL.Bool,
    'credential_ids' : IDL.Vec(IDL.Vec(IDL.Nat8)),
    'bytes' : IDL.Vec(IDL.Nat8),
  });
  const Result_4 = IDL.Variant({ 'Ok' : Challenge, 'Err' : Error });
  const Result_5 = IDL.Variant({ 'Ok' : IDL.Nat64, 'Err' : Error });
  const RestoreProgress = IDL.Record({
    'count' : IDL.Nat64,
    'root' : IDL.Vec(IDL.Nat8),
    'sequence' : IDL.Nat64,
  });
  const Result_6 = IDL.Variant({ 'Ok' : RestoreProgress, 'Err' : Error });
  const Result_7 = IDL.Variant({ 'Ok' : Revision, 'Err' : Error });
  const Derive = IDL.Record({
    'vault' : IDL.Vec(IDL.Nat8),
    'transport' : IDL.Vec(IDL.Nat8),
    'epoch' : IDL.Nat64,
    'assertion' : IDL.Opt(IDL.Text),
  });
  const KeyReply = IDL.Record({
    'encrypted_key' : IDL.Vec(IDL.Nat8),
    'public_key' : IDL.Vec(IDL.Nat8),
  });
  const Result_8 = IDL.Variant({ 'Ok' : KeyReply, 'Err' : Error });
  const ExportPage = IDL.Record({
    'next' : IDL.Opt(IDL.Nat64),
    'entries' : IDL.Vec(Revision),
  });
  const Result_9 = IDL.Variant({ 'Ok' : ExportPage, 'Err' : Error });
  const Result_10 = IDL.Variant({ 'Ok' : IDL.Opt(Export), 'Err' : Error });
  const Result_11 = IDL.Variant({ 'Ok' : IDL.Vec(IDL.Nat8), 'Err' : Error });
  const Quota = IDL.Record({
    'reserved' : IDL.Nat64,
    'limit' : IDL.Nat64,
    'current' : IDL.Nat64,
    'charged' : IDL.Nat64,
  });
  const Result_12 = IDL.Variant({ 'Ok' : Quota, 'Err' : Error });
  const CredentialInfo = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const Result_13 = IDL.Variant({
    'Ok' : IDL.Vec(CredentialInfo),
    'Err' : Error,
  });
  const ObjectPage = IDL.Record({
    'next' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'entries' : IDL.Vec(Revision),
  });
  const Result_14 = IDL.Variant({ 'Ok' : ObjectPage, 'Err' : Error });
  const Result_15 = IDL.Variant({ 'Ok' : IDL.Vec(Header), 'Err' : Error });
  const ManageCredential = IDL.Record({
    'remove' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'vault' : IDL.Vec(IDL.Nat8),
    'registration' : IDL.Opt(IDL.Text),
    'assertion' : IDL.Text,
  });
  const Reserve = IDL.Record({
    'vault' : IDL.Vec(IDL.Nat8),
    'operation' : IDL.Vec(IDL.Nat8),
  });
  return IDL.Service({
    'abort_export' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'activate_vault' : IDL.Func([Activate], [Result], []),
    'begin_export' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
        [Result_1],
        [],
      ),
    'begin_restore' : IDL.Func([BeginRestore], [Result], []),
    'begin_restore_revision' : IDL.Func(
        [IDL.Vec(IDL.Nat8), Revision],
        [Result_2],
        [],
      ),
    'begin_revision' : IDL.Func([BeginRevision], [Result_3], []),
    'begin_unlock' : IDL.Func([BeginUnlock], [Result_4], []),
    'collect_garbage' : IDL.Func([], [Result_5], []),
    'commit_restore' : IDL.Func([Activate], [Result], []),
    'commit_restore_revision' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Nat64],
        [Result_6],
        [],
      ),
    'commit_revision' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result_7], []),
    'delete_object' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8), IDL.Nat64, IDL.Vec(IDL.Nat8)],
        [Result_7],
        [],
      ),
    'derive_vault_key' : IDL.Func([Derive], [Result_8], []),
    'export_index' : IDL.Func([IDL.Vec(IDL.Nat8), IDL.Nat64], [Result_9], []),
    'finish_export' : IDL.Func([IDL.Vec(IDL.Nat8), IDL.Bool], [Result], []),
    'get_active_export' : IDL.Func([], [Result_10], []),
    'get_chunk' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8), IDL.Nat64, IDL.Nat32],
        [Result_11],
        ['query'],
      ),
    'get_export_chunk' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8), IDL.Nat64, IDL.Nat32],
        [Result_11],
        ['query'],
      ),
    'get_manifest' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8), IDL.Nat64],
        [Result_7],
        [],
      ),
    'get_quota' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result_12], []),
    'get_vault_header' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'list_credentials' : IDL.Func([], [Result_13], []),
    'list_history' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8), IDL.Nat64],
        [Result_9],
        [],
      ),
    'list_objects' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
        [Result_14],
        [],
      ),
    'list_vaults' : IDL.Func([], [Result_15], []),
    'manage_unlock_credential' : IDL.Func([ManageCredential], [Result_2], []),
    'prepare_unlock_credential' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Text],
        [Result_11],
        [],
      ),
    'purge_object' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
        [Result_2],
        [],
      ),
    'put_chunk' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Nat32, IDL.Vec(IDL.Nat8)],
        [Result_2],
        [],
      ),
    'put_restore_chunk' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Nat32, IDL.Vec(IDL.Nat8)],
        [Result_2],
        [],
      ),
    'reserve_vault' : IDL.Func([Reserve], [Result], []),
  });
};
export const init = ({ IDL }) => {
  const Config = IDL.Record({
    'minimum_cycles' : IDL.Nat64,
    'owner' : IDL.Principal,
    'origin' : IDL.Text,
    'key_name' : IDL.Text,
    'rp_id' : IDL.Text,
  });
  return [Config];
};
