-- INSERT 시 user_id·created_at 서버 강제 주입
create function public.set_user_id_from_jwt()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  return new;
end $$;

create trigger holdings_set_user_id
  before insert on public.holdings
  for each row execute function public.set_user_id_from_jwt();

create trigger transactions_set_user_id
  before insert on public.transactions
  for each row execute function public.set_user_id_from_jwt();

-- user_settings: created_at 칼럼 없고 updated_at만 있어서 user_id만 주입
create function public.set_user_id_only()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger user_settings_set_user_id
  before insert on public.user_settings
  for each row execute function public.set_user_id_only();

-- UPDATE 시 user_id / created_at 변경 차단 (trigger로 복원)
create function public.prevent_immutable_changes()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger holdings_prevent_immutable
  before update on public.holdings
  for each row execute function public.prevent_immutable_changes();

create trigger transactions_prevent_immutable
  before update on public.transactions
  for each row execute function public.prevent_immutable_changes();

-- user_settings UPDATE: user_id 변경 차단 + updated_at 자동 갱신
create function public.prevent_user_settings_changes()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := old.user_id;
  new.updated_at := now();
  return new;
end $$;

create trigger user_settings_prevent_immutable
  before update on public.user_settings
  for each row execute function public.prevent_user_settings_changes();

-- ai_usage atomic 증가 함수
create function public.increment_ai_usage(p_user_id uuid, p_date date)
returns table(count int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  insert into public.ai_usage (user_id, usage_date, count)
    values (p_user_id, p_date, 1)
    on conflict (user_id, usage_date)
    do update set count = ai_usage.count + 1
    returning ai_usage.count;
end $$;

-- service_role과 authenticated만 호출 가능
revoke all on function public.increment_ai_usage from public, anon;
grant execute on function public.increment_ai_usage to service_role;

-- 화이트리스트 enforce 트리거
create function public.enforce_invite_only()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
begin
  if not exists (select 1 from public.allowed_emails where email = new.email) then
    raise exception 'Email not in invite list: %', new.email
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger users_invite_check
  before insert on auth.users
  for each row execute function public.enforce_invite_only();
