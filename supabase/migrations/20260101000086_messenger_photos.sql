-- GODAC Messenger: photo attachments. A message can now carry a photo
-- instead of (or alongside) text -- body becomes optional, but at
-- least one of the two must be present. Storage policies additionally
-- let the recipient read a photo via a lookup against the messages
-- row (not just the uploader's own folder), since a conversation
-- photo needs to reach the other person -- unlike tank/ticket photos
-- that only a manager-like reviewer needs to see.
alter table messages alter column body drop not null;
alter table messages add column photo_path text;
alter table messages add constraint messages_body_or_photo check (body is not null or photo_path is not null);

insert into storage.buckets (id, name, public)
values ('messenger-photos', 'messenger-photos', false)
on conflict (id) do nothing;

create policy "messenger-photos: sender reads own upload"
  on storage.objects for select
  using (
    bucket_id = 'messenger-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (storage.foldername(name))[2] = public.current_app_user_id()::text
  );

create policy "messenger-photos: recipient reads via message"
  on storage.objects for select
  using (
    bucket_id = 'messenger-photos'
    and exists (
      select 1 from messages m
      where m.photo_path = storage.objects.name
        and m.recipient_id = public.current_app_user_id()
    )
  );

create policy "messenger-photos: sender uploads to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'messenger-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (storage.foldername(name))[2] = public.current_app_user_id()::text
  );
