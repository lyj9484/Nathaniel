-- 사용자가 supabase.auth.updateUser({email})로 이메일을 ADMIN_EMAILS의 값으로
-- 바꿔 admin 권한을 획득하는 경로를 차단. 기존 003의 enforce_invite_only는
-- INSERT만 커버하므로 UPDATE에도 적용.
create trigger users_invite_check_update
  before update of email on auth.users
  for each row execute function public.enforce_invite_only();
