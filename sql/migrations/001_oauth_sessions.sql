create table if not exists oauth_sessions (
  session_id text primary key,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text null,
  scope text[] not null default '{}',
  expires_at_unix bigint null,
  linked_account_id text null,
  linked_account_username text null,
  created_at_unix bigint not null,
  updated_at_unix bigint not null,
  last_used_at_unix bigint not null,
  status text not null check (status in ('active', 'expired', 'revoked', 'invalid'))
);

create index if not exists oauth_sessions_status_expires_idx
  on oauth_sessions (status, expires_at_unix);

create table if not exists oauth_pending_auth (
  state_hash text primary key,
  code_verifier_ciphertext text not null,
  created_at_unix bigint not null,
  expires_at_unix bigint not null,
  status text not null default 'active' check (status in ('active', 'consumed', 'expired', 'invalid'))
);

create index if not exists oauth_pending_auth_expires_idx
  on oauth_pending_auth (expires_at_unix);
