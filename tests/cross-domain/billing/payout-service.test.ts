import { describe, it, expect, beforeEach, vi } from "vitest";
import { payoutService } from "../../../server/domain/billing/payout.service";
import { db } from "@server/database_service.js";
import { apps, appPayouts, orgs } from "@shared/schema/index";
import { eq } from "drizzle-orm";

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

describe("PayoutService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should not record payout if app has 0 price", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, pricePerLaunchUsd: '0.00', developerOrgId: 10 }])
                })
            })
        });

        await payoutService.recordAppLaunchPayout(1);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("should record accurate payout for paid apps", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{
                        id: 1,
                        slug: 'test-app',
                        pricePerLaunchUsd: '10.00',
                        developerOrgId: 10,
                        developerPayoutPercentage: 70
                    }])
                })
            })
        });

        (db.insert as any).mockReturnValue({
            values: vi.fn().mockResolvedValue([{}])
        });

        await payoutService.recordAppLaunchPayout(1);

        expect(db.insert).toHaveBeenCalledWith(appPayouts);
        const insertCall = (db.insert as any).mock.results[0].value.values.mock.calls[0][0];
        expect(insertCall.amountUsd).toBe("7.000000"); // 10.00 * 0.7
        expect(insertCall.developerOrgId).toBe(10);
    });

    it("should calculate total accrued correctly", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ total: "150.50" }])
            })
        });

        const total = await payoutService.getAccruedEarnings(10);
        expect(total).toBe(150.5);
    });
});
