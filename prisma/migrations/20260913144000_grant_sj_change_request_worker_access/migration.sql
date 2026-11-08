-- Worker hanya perlu membaca korelasi event dan menandai hasil sinkronisasi
-- request perubahan. Pembuatan serta keputusan request tetap milik aplikasi.

DO $grant_sj_change_request_worker$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_sj_worker') THEN
    GRANT SELECT ON public.sj_control_change_requests TO ruwang_sj_worker;
    GRANT UPDATE (state, completed_at, failure_code, updated_at)
      ON public.sj_control_change_requests TO ruwang_sj_worker;
  END IF;
END
$grant_sj_change_request_worker$;

