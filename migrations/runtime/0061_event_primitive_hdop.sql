-- Horizontal Dilution of Precision on spatial signals.
--
-- Enables the Gaussian uncertainty layer: horizontal error ≈ HDOP × UERE, which
-- lets the precision gate reason about an error ELLIPSE rather than a circle.
--
-- Additive and nullable. `spatial_precision_m` remains the primary input; most
-- sources supply only a radius, and a radius is simply the isotropic case
-- (Sigma = sigma^2 * I), so nothing changes for them.
--
-- MUST BE HDOP, NOT PDOP: PDOP^2 = HDOP^2 + VDOP^2, and vertical geometry is
-- systematically worse (all satellites are overhead). H3 containment is 2-D, so
-- storing PDOP here would inflate the error region with vertical error that
-- cannot affect a containment answer.

ALTER TABLE "event_primitives"
  ADD COLUMN IF NOT EXISTS "spatial_hdop" real;
