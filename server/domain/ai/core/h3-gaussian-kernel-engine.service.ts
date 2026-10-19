import { gridDisk, cellToLatLng, greatCircleDistance, UNITS } from "h3-js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("H3GaussianKernelEngine");

export interface H3GaussianFieldCell {
    h3Index: string;
    distanceMeters: number;
    kRingDistance: number;
    rawRiskPhi: number;
    generalizedRiskPhi: number; // Applied Gaussian Kernel: Phi * exp(-d^2 / 2sigma^2)
    gaussianWeight: number;    // exp(-d^2 / 2sigma^2)
}

export interface H3GaussianKernelResult {
    originH3: string;
    kernelSigmaMeters: number;
    totalCellsInKernel: number;
    generalizedField: H3GaussianFieldCell[];
    processingLatencyMs: number;
}

/**
 * H3 Gaussian Kernel Engine (Spatial Generalization System):
 * Applies isotropic Gaussian Kernel Density Estimation (KDE) over H3 hexagonal grids:
 *
 *   Phi(h_i) = Phi(h_0) * exp( - d(h_0, h_i)^2 / (2 * sigma^2) )
 *
 * Eliminates discrete edge artifacts, smooths spatial volatility, and provides continuous
 * probabilistic generalization for risk fields, event signals, and fleet safety boundaries.
 */
export class H3GaussianKernelEngineService {
    /**
     * Computes a multi-ring Gaussian smooth risk field around an origin H3 index.
     *
     * @param originH3 Origin H3 cell index
     * @param originRiskPhi Risk flux density at origin [0.0 to 1.0]
     * @param kRings Number of H3 neighbor rings to expand (e.g. k=2 or k=3)
     * @param sigmaMeters Spatial bandwidth/variance parameter (e.g. 500 meters)
     */
    public static computeGaussianGeneralization(
        originH3: string,
        originRiskPhi: number,
        kRings = 2,
        sigmaMeters = 500
    ): H3GaussianKernelResult {
        const startTime = performance.now();
        const originLatLng = cellToLatLng(originH3);

        // 1. Expand k-Ring Neighborhood using H3 gridDisk
        const cellDisk = gridDisk(originH3, kRings);

        // 2. Compute Gaussian decay for each cell in the disk
        const generalizedField: H3GaussianFieldCell[] = cellDisk.map(h3Index => {
            const cellLatLng = cellToLatLng(h3Index);
            const distanceMeters = h3Index === originH3
                ? 0
                : Number(greatCircleDistance(originLatLng, cellLatLng, UNITS.m).toFixed(1));

            // Gaussian Kernel Weight: w = exp( - d^2 / (2 * sigma^2) )
            const gaussianWeight = Number(
                Math.exp(-Math.pow(distanceMeters, 2) / (2 * Math.pow(sigmaMeters, 2))).toFixed(4)
            );

            // Generalized Risk Phi: Phi_generalized = Phi_origin * w
            const generalizedRiskPhi = Number((originRiskPhi * gaussianWeight).toFixed(3));

            return {
                h3Index,
                distanceMeters,
                kRingDistance: h3Index === originH3 ? 0 : 1, // Approximated ring
                rawRiskPhi: h3Index === originH3 ? originRiskPhi : 0,
                generalizedRiskPhi,
                gaussianWeight
            };
        });

        const processingLatencyMs = Number((performance.now() - startTime).toFixed(2));

        logger.info(
            `[H3GaussianKernelEngine] Generalized H3 [${originH3}] across ${generalizedField.length} cells (sigma = ${sigmaMeters}m) in ${processingLatencyMs}ms.`
        );

        return {
            originH3,
            kernelSigmaMeters: sigmaMeters,
            totalCellsInKernel: generalizedField.length,
            generalizedField,
            processingLatencyMs
        };
    }
}
