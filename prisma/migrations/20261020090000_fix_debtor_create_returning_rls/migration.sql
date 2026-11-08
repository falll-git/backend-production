-- INSERT RETURNING is checked before the row exists for an ID helper lookup.
-- The row-local branch admits only an active row created by the current actor
-- with an existing debtor read scope. Keep the original helper for all other
-- ownership/division/contract paths, including selected-update checks.
ALTER POLICY digital_debtors_read ON public.digital_debtors
  USING (
    (deleted_at IS NULL AND public.ruwang_arsip_debtor_read_scope_mode() > 0
      AND created_by = public.ruwang_arsip_current_user_id())
    OR public.ruwang_arsip_can_read_debtor(id)
  );

ALTER POLICY debtor_contracts_read ON public.debtor_contracts
  USING (
    (deleted_at IS NULL AND public.ruwang_arsip_debtor_read_scope_mode() > 0
      AND created_by = public.ruwang_arsip_current_user_id())
    OR public.ruwang_arsip_can_read_contract(id)
  );

-- Preserve the prior selected-update rejection of a new, unreadable contract ID.
-- Other UPDATE USING conditions, commands, roles, ACLs and FORCE RLS stay intact.
ALTER POLICY debtor_contracts_update ON public.debtor_contracts
  WITH CHECK (
    public.ruwang_arsip_can_manage_debtor(debtor_id)
    AND public.ruwang_arsip_can_read_contract(id)
  );
