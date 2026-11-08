-- Replacing draft details/photos is part of the existing publication UPDATE
-- endpoint, not permission to delete a publication or an approved snapshot.
-- Existing delete access remains scoped; both paths require a DRAFT version.
DO $draft_content$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sj_land_details', 'sj_building_details', 'sj_machine_details',
    'sj_vehicle_details', 'sj_publication_version_media'
  ] LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (
        (public.ruwang_arsip_sj_can_access_version(publication_version_id, ''delete'')
          OR (public.ruwang_arsip_has_menu_permission(
                ARRAY[''/dashboard/seputar-jaminan/publikasi'']::text[], ''update'')
              AND public.ruwang_arsip_sj_can_access_version(publication_version_id, ''update'')))
        AND EXISTS (SELECT 1 FROM public.sj_publication_versions version
                    WHERE version.id = publication_version_id AND version.state = ''DRAFT'')
      )', table_name || '_delete', table_name);
  END LOOP;
END
$draft_content$;
