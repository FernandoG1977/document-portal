create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text,role text not null default 'client' check(role in('client','admin')),created_at timestamptz not null default now());
create table if not exists public.documents(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,user_email text,client_name text not null,reference text not null,document_type text not null default 'Otro',comments text,file_path text not null unique,original_name text not null,file_size bigint,mime_type text,created_at timestamptz not null default now());
alter table public.profiles enable row level security;alter table public.documents enable row level security;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$begin insert into public.profiles(id,email,role) values(new.id,new.email,'client') on conflict(id) do nothing;return new;end;$$;
drop trigger if exists on_auth_user_created on auth.users;create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin');$$;
drop policy if exists "read own profile" on public.profiles;create policy "read own profile" on public.profiles for select to authenticated using(id=auth.uid());
drop policy if exists "read docs" on public.documents;create policy "read docs" on public.documents for select to authenticated using(user_id=auth.uid() or public.is_admin());
drop policy if exists "insert docs" on public.documents;create policy "insert docs" on public.documents for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "delete docs admin" on public.documents;create policy "delete docs admin" on public.documents for delete to authenticated using(public.is_admin());
insert into storage.buckets(id,name,public) values('documents','documents',false) on conflict(id) do update set public=false;
drop policy if exists "upload own" on storage.objects;create policy "upload own" on storage.objects for insert to authenticated with check(bucket_id='documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "read own or admin" on storage.objects;create policy "read own or admin" on storage.objects for select to authenticated using(bucket_id='documents' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin()));
drop policy if exists "delete admin" on storage.objects;create policy "delete admin" on storage.objects for delete to authenticated using(bucket_id='documents' and public.is_admin());
-- Después crea tu usuario administrador y ejecuta:
-- update public.profiles set role='admin' where email='TU_CORREO@EMPRESA.COM';
