-- Lock controlled public vocabularies selected for contract V1 (Option A).
-- Optional attributes remain nullable, but any supplied value must be known.

ALTER TABLE public.sj_land_details
  ADD CONSTRAINT sj_land_details_contour_v1
    CHECK (contour IS NULL OR contour IN ('DATAR', 'MIRING', 'BERKONTUR')),
  ADD CONSTRAINT sj_land_details_road_access_v1
    CHECK (road_access IS NULL OR road_access IN ('RODA_DUA', 'MOBIL', 'TRUK'));

ALTER TABLE public.sj_building_details
  ADD CONSTRAINT sj_building_details_public_usage_v1
    CHECK (
      public_usage IS NULL
      OR public_usage IN ('HUNIAN', 'KOMERSIAL', 'PERKANTORAN', 'PERGUDANGAN', 'INDUSTRI', 'SERBAGUNA')
    );

ALTER TABLE public.sj_machine_details
  ADD CONSTRAINT sj_machine_details_public_condition_v1
    CHECK (public_condition IN ('SANGAT_BAIK', 'BAIK', 'CUKUP', 'PERLU_PERBAIKAN'));

ALTER TABLE public.sj_vehicle_details
  ADD CONSTRAINT sj_vehicle_details_transmission_v1
    CHECK (transmission IS NULL OR transmission IN ('MANUAL', 'OTOMATIS')),
  ADD CONSTRAINT sj_vehicle_details_fuel_type_v1
    CHECK (fuel_type IS NULL OR fuel_type IN ('BENSIN', 'DIESEL', 'LISTRIK', 'HIBRIDA', 'GAS')),
  ADD CONSTRAINT sj_vehicle_details_public_condition_v1
    CHECK (public_condition IN ('SANGAT_BAIK', 'BAIK', 'CUKUP', 'PERLU_PERBAIKAN'));
