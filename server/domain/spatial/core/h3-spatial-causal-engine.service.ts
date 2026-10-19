export interface H3HexCell {
    h3Index: string; // e.g. "8828308281fffff"
    latitude: number;
    longitude: number;
    baseRiskScore: number;
    activeAgentsCount: number;
}

export interface SpatialRiskPropagationResult {
    targetH3Index: string;
    localRisk: number;
    spatialLagRisk: number; // Risk propagated from k-ring neighbors
    totalCompositeRisk: number;
    kRingNeighborCount: number;
    recommendedSpatialReroute: boolean;
}

export const h3SpatialCausalEngineService = {
    /**
     * Computes spatial lag risk propagation from surrounding k-ring hexagonal neighbors
     */
    calculateSpatialRiskPropagation(
        targetCell: H3HexCell,
        neighborCells: H3HexCell[],
        decayFactor: number = 0.5
    ): SpatialRiskPropagationResult {
        if (!neighborCells || neighborCells.length === 0) {
            return {
                targetH3Index: targetCell.h3Index,
                localRisk: targetCell.baseRiskScore,
                spatialLagRisk: 0,
                totalCompositeRisk: targetCell.baseRiskScore,
                kRingNeighborCount: 0,
                recommendedSpatialReroute: targetCell.baseRiskScore > 0.70
            };
        }

        // Sum spatial lag weighted by neighbor risk and decay factor
        let neighborRiskSum = 0;
        for (const neighbor of neighborCells) {
            neighborRiskSum += neighbor.baseRiskScore * decayFactor;
        }

        const spatialLagRisk = Number((neighborRiskSum / neighborCells.length).toFixed(3));
        const totalCompositeRisk = Number(Math.min(1.0, targetCell.baseRiskScore * 0.6 + spatialLagRisk * 0.4).toFixed(3));
        const recommendedSpatialReroute = totalCompositeRisk > 0.65;

        return {
            targetH3Index: targetCell.h3Index,
            localRisk: targetCell.baseRiskScore,
            spatialLagRisk,
            totalCompositeRisk,
            kRingNeighborCount: neighborCells.length,
            recommendedSpatialReroute
        };
    }
};
