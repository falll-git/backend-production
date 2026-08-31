-- Vocabulary V1 pinned to @seputarjaminan/contracts 1.0.0.
INSERT INTO public.sj_taxonomy_versions
  (id, version, checksum, signature_metadata, valid_from, fetched_at, is_active)
VALUES
  ('10000000-0000-4000-8000-000000000001', 1,
   '134d0f3f3264e77d5611f167152a968eace852a27f9df63dc0f7b753f25558e8',
   '{"source":"@seputarjaminan/contracts","contract_version":"1.0.0","verification":"BUILTIN_PINNED_CHECKSUM"}'::jsonb,
   TIMESTAMP WITH TIME ZONE '2026-08-22 00:00:00+00', CURRENT_TIMESTAMP, true)
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.sj_taxonomy_items
  (id, taxonomy_version, code, parent_code, category, label_id, required_field_schema, is_active)
VALUES
  ('11000000-0000-4000-8000-000000000001',1,'TANAH',NULL,'LAND','Tanah','{"required":["land_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000002',1,'RUMAH','BANGUNAN','BUILDING','Rumah','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000003',1,'RUKO','BANGUNAN','BUILDING','Ruko','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000004',1,'KIOS','BANGUNAN','BUILDING','Kios','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000005',1,'KANTOR','BANGUNAN','BUILDING','Kantor','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000006',1,'GUDANG','BANGUNAN','BUILDING','Gudang','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000007',1,'PABRIK','BANGUNAN','BUILDING','Pabrik','{"required":["building_area_m2"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000008',1,'EXCAVATOR','MESIN_PERALATAN','MACHINE_EQUIPMENT','Excavator','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000009',1,'BULDOSER','MESIN_PERALATAN','MACHINE_EQUIPMENT','Buldoser','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000010',1,'CRANE','MESIN_PERALATAN','MACHINE_EQUIPMENT','Crane','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000011',1,'MESIN_MANUFAKTUR','MESIN_PERALATAN','MACHINE_EQUIPMENT','Mesin manufaktur','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000012',1,'PERALATAN_KONSTRUKSI','MESIN_PERALATAN','MACHINE_EQUIPMENT','Peralatan konstruksi','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000013',1,'PERALATAN_PERTANIAN','MESIN_PERALATAN','MACHINE_EQUIPMENT','Peralatan pertanian','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000014',1,'PERALATAN_MEDIS','MESIN_PERALATAN','MACHINE_EQUIPMENT','Peralatan medis','{"required":["model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000015',1,'MOBIL','KENDARAAN','VEHICLE','Mobil','{"required":["brand","model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000016',1,'MOTOR','KENDARAAN','VEHICLE','Motor','{"required":["brand","model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000017',1,'TRUK','KENDARAAN','VEHICLE','Truk','{"required":["brand","model_or_type","public_condition"]}'::jsonb,true),
  ('11000000-0000-4000-8000-000000000018',1,'BUS','KENDARAAN','VEHICLE','Bus','{"required":["brand","model_or_type","public_condition"]}'::jsonb,true)
ON CONFLICT (taxonomy_version, code) DO NOTHING;
