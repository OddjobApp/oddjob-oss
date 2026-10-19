-- Spatial Regions: named geographic areas as mixed-resolution H3 cell sets.
--
-- The shape follows shared/schema/spatial-regions.ts, and the omissions there are
-- deliberate rather than deferred: no centroid, no bounding box and no stored
-- neighbour list. All three would let a caller answer "is this asset in the
-- region?" without going through the three-valued containment in
-- spatial-containment.ts, and the whole point of that module is that a position
-- too imprecise to place must read as INDETERMINATE rather than as OUTSIDE.
--
-- `cells` is the geometry: a JSON array of H3 cell ids at mixed resolutions,
-- coarse through the interior and fine at the boundary. It is passed directly to
-- containment(position, cells).

CREATE TABLE IF NOT EXISTS "spatial_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'region' NOT NULL,
	"cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_resolution" integer,
	"max_resolution" integer,
	"parent_region_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so both are guarded the same way
-- 0077_drift_repair_baselined_tables.sql guards its own.
DO $$ BEGIN
  BEGIN
    ALTER TABLE "spatial_regions" ADD CONSTRAINT "spatial_regions_organization_id_orgs_org_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  -- Self-reference for containment nesting (a zone inside a region). SET NULL, not
  -- CASCADE: deleting a parent must never delete the areas inside it.
  BEGIN
    ALTER TABLE "spatial_regions" ADD CONSTRAINT "spatial_regions_parent_region_id_fk"
      FOREIGN KEY ("parent_region_id") REFERENCES "public"."spatial_regions"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  -- `kind` is descriptive, but a typo would silently create a fourth category that
  -- no UI filters on, so the three valid values are enforced here.
  BEGIN
    ALTER TABLE "spatial_regions" ADD CONSTRAINT "spatial_regions_kind_check"
      CHECK ("kind" IN ('region', 'zone', 'corridor'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS "idx_spatial_regions_org" ON "spatial_regions" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_spatial_regions_parent" ON "spatial_regions" USING btree ("parent_region_id");
CREATE INDEX IF NOT EXISTS "idx_spatial_regions_kind" ON "spatial_regions" USING btree ("kind");
