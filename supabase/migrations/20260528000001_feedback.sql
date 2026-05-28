-- feedback 테이블: 카테고리 + 본문 + 메타데이터
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  category    text not null check (category in
              ('design','ui','ux','price_data','other')),
  body        text not null check (char_length(body) between 1 and 2000),
  user_agent  text,
  page_url    text,
  created_at  timestamptz not null default now()
);

create index feedback_category_created_at_idx
  on public.feedback (category, created_at desc);
create index feedback_user_id_idx
  on public.feedback (user_id);

-- RLS
alter table public.feedback enable row level security;
alter table public.feedback force row level security;

create policy feedback_insert_own on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

create policy feedback_select_own on public.feedback
  for select to authenticated using (auth.uid() = user_id);

-- user_id 자동 주입 (003+004 가드 함수 재사용)
create trigger feedback_set_user_id
  before insert on public.feedback
  for each row execute function public.set_user_id_from_jwt();

-- 권한 회수 + 최소 권한 (select, insert만 — update/delete 정책 없음)
revoke all on public.feedback from public, anon;
grant select, insert on public.feedback to authenticated;
