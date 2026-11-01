-- Private bucket for content-addressed blob bytes (object key = sha256 hex): rendered PDFs, SyncTeX files, figure
-- PNGs, a paper's binary source assets. No storage policies: only the service-role client reads or writes it, and
-- /api/blobs/:sha serves it through short-lived signed URLs. 50 MB per object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('blobs', 'blobs', false, 52428800)
on conflict (id) do nothing;
