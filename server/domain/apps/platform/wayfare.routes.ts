import { Router, type Request, type Response } from "express";
import {
  accommodationConfiguration,
  searchWayfareAccommodation,
} from "../core/wayfare-accommodation.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import {
  listWayfareTrips,
  saveWayfareTrip,
} from "../core/wayfare-trips.service.js";
import {
  mapboxConfiguration,
  mapboxBrowserToken,
  calculateWayfareRoute,
  geocodeWayfare,
  findWayfareChargers,
} from "../core/wayfare-mapbox.service.js";
const router = Router();
router.use(requireAppToken("datasets"));
router.get(
  "/accommodations",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await accommodationConfiguration(
        req.appTokenContext!,
        req.query.crewRoom,
      ),
    );
  }),
);
router.post(
  "/accommodations",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await searchWayfareAccommodation(
        req.appTokenContext!,
        req.query.crewRoom,
        req.body,
      ),
    );
  }),
);
router.post(
  "/chargers",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await findWayfareChargers(
        req.appTokenContext!,
        req.query.crewRoom,
        req.body ?? {},
      ),
    );
  }),
);
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listWayfareTrips(req.appTokenContext!, req.query.crewRoom));
  }),
);
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await saveWayfareTrip(req.appTokenContext!, req.query.crewRoom, req.body),
    );
  }),
);
router.get(
  "/mapbox",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await mapboxConfiguration(req.appTokenContext!, req.query.crewRoom),
    );
  }),
);
router.get(
  "/mapbox/token",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await mapboxBrowserToken(
        req.appTokenContext!,
        req.query.crewRoom,
        req.query.credentialId,
      ),
    );
  }),
);
router.post(
  "/route",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await calculateWayfareRoute(
        req.appTokenContext!,
        req.query.crewRoom,
        req.body ?? {},
      ),
    );
  }),
);
router.post(
  "/geocode",
  requireAppToken("integrations"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await geocodeWayfare(
        req.appTokenContext!,
        req.query.crewRoom,
        req.body ?? {},
      ),
    );
  }),
);
export { router as wayfareTripsRouter };
