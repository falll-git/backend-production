-- PostgreSQL evaluates SELECT policies for rows returned by INSERT ... RETURNING.
-- The existing helper functions locate a parent row by id, which cannot reliably
-- observe that row while the INSERT statement itself is still returning it.
-- Keep the existing scoped helpers, but make the already-authorized creator (and
-- digital-document owner) directly eligible to read the newly inserted row.

DROP POLICY IF EXISTS digital_documents_read_scope ON public.digital_documents;
CREATE POLICY digital_documents_read_scope ON public.digital_documents
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = public.ruwang_arsip_current_user_id()
      OR owner_user_id = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_can_select_digital_document(id)
    )
  );

DROP POLICY IF EXISTS incoming_mails_read ON public.incoming_mails;
CREATE POLICY incoming_mails_read ON public.incoming_mails
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_can_read_incoming_mail(id)
    )
  );

DROP POLICY IF EXISTS outgoing_mails_read ON public.outgoing_mails;
CREATE POLICY outgoing_mails_read ON public.outgoing_mails
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_can_read_outgoing_mail(id)
    )
  );

DROP POLICY IF EXISTS memorandums_read ON public.memorandums;
CREATE POLICY memorandums_read ON public.memorandums
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_can_read_memorandum(id)
    )
  );
