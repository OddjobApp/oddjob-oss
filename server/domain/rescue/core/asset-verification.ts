/**
 * Asset maintenance verification.
 *
 * Resolves the serial number a requester submits against the org's Managed
 * Assets dataset and reports whether the asset carries an active maintenance
 * contract. Operations use this to decide whether a dispatch is covered, and
 * the requester's tracking card surfaces it so they know before anyone rolls.
 *
 * Previously the only "verification" in the flow was a hardcoded string written
 * into the ops dataset record by syncToAppDataset — every rescue claimed an
 * "Active Maintenance Contract (Verified)" regardless of the serial submitted,
 * including serials that match no asset at all. That is a claim the platform
 * cannot back, on exactly the kind of question (is this covered?) where being
 * wrong is expensive. This does the lookup and reports what it finds.
 *
 * Deterministic and model-free, so it works unchanged in limp mode.
 */
import { db } from "@server/database_service.js";
import { datasets, datasetItems } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AssetVerification");

export interface AssetVerification {
    /** True only when a matching asset was found AND its contract reads active. */
    verified: boolean;
    /** Human-readable status for display, always populated. */
    status: string;
    /** Contract reference when known. */
    contract: string | null;
    serialNumber: string | null;
    assetName: string | null;
    assetId: string | null;
}

const UNVERIFIED = (serialNumber: string | null, status: string): AssetVerification => ({
    verified: false,
    status,
    contract: null,
    serialNumber,
    assetName: null,
    assetId: null,
});

/**
 * Look up `serialNumber` in the org's Managed Assets dataset.
 *
 * Never throws: verification is advisory context on a dispatch that must still
 * proceed, so a lookup failure downgrades to "could not verify" rather than
 * blocking an emergency request.
 */
export async function verifyAssetMaintenance(
    orgId: number,
    serialNumber?: string | null,
): Promise<AssetVerification> {
    const serial = (serialNumber || "").trim();
    if (!serial) return UNVERIFIED(null, "No asset serial provided");

    try {
        const [assetDataset] = await db
            .select({ id: datasets.id })
            .from(datasets)
            .where(and(eq(datasets.organizationId, orgId), eq(datasets.name, "Managed Assets")))
            .limit(1);

        if (!assetDataset) return UNVERIFIED(serial, "Managed Assets dataset not configured");

        const items = await db
            .select({ data: datasetItems.data })
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, assetDataset.id));

        const match = items.find((item) => {
            const data = (item.data ?? {}) as Record<string, unknown>;
            const candidate = String(data.serialNumber ?? data.serial_number ?? "").trim();
            return candidate.toLowerCase() === serial.toLowerCase();
        });

        if (!match) return UNVERIFIED(serial, `No managed asset matches serial ${serial}`);

        const data = (match.data ?? {}) as Record<string, any>;
        const contract: string | null = data.maintenanceContract ?? data.maintenance_contract ?? null;
        const contractStatus = String(data.contractStatus ?? data.contract_status ?? "").trim();

        // "Active" can be carried either by the contract text or the status
        // field depending on how the asset was ingested; accept both.
        const isActive =
            /verified|active/i.test(contractStatus) || /active/i.test(String(contract ?? ""));

        return {
            verified: isActive,
            status: isActive
                ? `Active Maintenance Contract (Verified)`
                : `Asset found, but no active maintenance contract`,
            contract,
            serialNumber: serial,
            assetName: data.name ?? data.target ?? null,
            assetId: data.assetId ?? data.asset_id ?? null,
        };
    } catch (err: any) {
        logger.warn(`Asset verification failed for serial ${serial}: ${err.message}`);
        return UNVERIFIED(serial, "Asset verification temporarily unavailable");
    }
}
