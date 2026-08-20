-- Access requests and loans are inserted with Prisma INSERT ... RETURNING.
-- Their previous SELECT policies only called an id-based helper; during the
-- INSERT statement that helper cannot reliably observe the row being returned.
-- Direct actor predicates preserve the same business scope while allowing the
-- legitimate requester/borrower to receive the row created by their request.

DROP POLICY IF EXISTS digital_document_access_requests_read
  ON public.digital_document_access_requests;
CREATE POLICY digital_document_access_requests_read
  ON public.digital_document_access_requests
  FOR SELECT USING (
    requester_id = public.ruwang_arsip_current_user_id()
    OR owner_id = public.ruwang_arsip_current_user_id()
    OR acted_by = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_read_access_request(id)
  );

DROP POLICY IF EXISTS digital_document_loans_read
  ON public.digital_document_loans;
CREATE POLICY digital_document_loans_read
  ON public.digital_document_loans
  FOR SELECT USING (
    borrower_id = public.ruwang_arsip_current_user_id()
    OR approved_by = public.ruwang_arsip_current_user_id()
    OR handed_over_by = public.ruwang_arsip_current_user_id()
    OR returned_by = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_read_document_loan(id)
  );
