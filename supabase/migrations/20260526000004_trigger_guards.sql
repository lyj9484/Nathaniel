-- 003의 트리거 함수들은 service_role 호출(admin client, auth.uid() = null)에서도 동작해서
-- user_id를 null로 덮어써 NOT NULL constraint를 위반시킨다.
-- 의도: 클라이언트(authenticated) 호출일 때만 user_id를 auth.uid()로 강제하고,
--       service_role 호출에서는 클라이언트가 명시한 user_id를 그대로 둔다.

create or replace function public.set_user_id_from_jwt()
returns trigger language plpgsql security invoker as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  new.created_at := now();
  return new;
end $$;

create or replace function public.set_user_id_only()
returns trigger language plpgsql security invoker as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.prevent_immutable_changes()
returns trigger language plpgsql security invoker as $$
begin
  if auth.uid() is not null then
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create or replace function public.prevent_user_settings_changes()
returns trigger language plpgsql security invoker as $$
begin
  if auth.uid() is not null then
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
