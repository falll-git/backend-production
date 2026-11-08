-- The signed Control archive lifecycle writes this timestamp together with
-- state/version/outbox. Keep the dedicated reviewer role column-scoped.
-- No data rewrite, DELETE grant, ownership or RLS policy change.
GRANT UPDATE (archived_at) ON public.sj_publications TO ruwang_sj_review;
