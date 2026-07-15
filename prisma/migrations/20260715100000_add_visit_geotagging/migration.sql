-- Add nullable geotag evidence for marketing visit results. Existing rows remain valid.
ALTER TABLE "debtor_marketing_activities"
  ADD COLUMN "visit_latitude" NUMERIC(9, 6),
  ADD COLUMN "visit_longitude" NUMERIC(9, 6),
  ADD COLUMN "visit_location_accuracy_m" NUMERIC(12, 3),
  ADD COLUMN "visit_location_recorded_at" TIMESTAMPTZ(3);

ALTER TABLE "debtor_marketing_activities"
  ADD CONSTRAINT "dma_visit_latitude_range_chk"
    CHECK ("visit_latitude" IS NULL OR "visit_latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "dma_visit_longitude_range_chk"
    CHECK ("visit_longitude" IS NULL OR "visit_longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "dma_visit_accuracy_nonnegative_chk"
    CHECK ("visit_location_accuracy_m" IS NULL OR "visit_location_accuracy_m" >= 0),
  ADD CONSTRAINT "dma_visit_coordinate_pair_chk"
    CHECK (("visit_latitude" IS NULL) = ("visit_longitude" IS NULL)),
  ADD CONSTRAINT "dma_visit_metadata_coordinate_chk"
    CHECK (
      ("visit_latitude" IS NULL
        AND "visit_location_accuracy_m" IS NULL
        AND "visit_location_recorded_at" IS NULL)
      OR ("visit_latitude" IS NOT NULL
        AND "visit_location_recorded_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "dma_visit_location_kind_chk"
    CHECK (
      ("visit_latitude" IS NULL AND "visit_longitude" IS NULL
        AND "visit_location_accuracy_m" IS NULL
        AND "visit_location_recorded_at" IS NULL)
      OR "activity_kind" = 'VISIT_RESULT'
    );
