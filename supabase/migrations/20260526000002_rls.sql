-- RLS enable + FORCE (postgres role bypass도 차단)
alter table public.holdings        enable row level security;
alter table public.transactions    enable row level security;
alter table public.user_settings   enable row level security;
alter table public.ai_usage        enable row level security;
alter table public.allowed_emails  enable row level security;

alter table public.holdings        force row level security;
alter table public.transactions    force row level security;
alter table public.user_settings   force row level security;
alter table public.ai_usage        force row level security;
alter table public.allowed_emails  force row level security;

-- 권한 회수
revoke all on public.holdings, public.transactions,
              public.user_settings, public.ai_usage, public.allowed_emails
  from public, anon;

-- 최소 권한
grant select, insert, update, delete
  on public.holdings, public.transactions, public.user_settings
  to authenticated;
grant select on public.ai_usage to authenticated;
-- allowed_emails는 service_role만 (authenticated에도 grant 안 함)

-- holdings
create policy holdings_select on public.holdings
  for select to authenticated using (user_id = auth.uid());

create policy holdings_insert on public.holdings
  for insert to authenticated with check (user_id = auth.uid());

create policy holdings_update on public.holdings
  for update to authenticated
  using       (user_id = auth.uid())
  with check  (user_id = auth.uid());

create policy holdings_delete on public.holdings
  for delete to authenticated using (user_id = auth.uid());

-- transactions: 본인 + holding 소유권 검증
create policy tx_select on public.transactions
  for select to authenticated using (user_id = auth.uid());

create policy tx_insert on public.transactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.holdings h
      where h.id = holding_id and h.user_id = auth.uid()
    )
  );

create policy tx_update on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.holdings h
      where h.id = holding_id and h.user_id = auth.uid()
    )
  );

create policy tx_delete on public.transactions
  for delete to authenticated using (user_id = auth.uid());

-- user_settings (DELETE 정책 의도적 미작성 → 차단됨)
create policy us_select on public.user_settings
  for select to authenticated using (user_id = auth.uid());

create policy us_insert on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

create policy us_update on public.user_settings
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_usage: SELECT만 허용, 갱신은 service_role
create policy au_select on public.ai_usage
  for select to authenticated using (user_id = auth.uid());
