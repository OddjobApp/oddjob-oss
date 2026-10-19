import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { hubspotConnector } from "@server/integrations/hubspot-connector.js";
import { salesforceConnector } from "@server/integrations/salesforce-connector.js";
import { salesStoreForOrg } from "./sales-records-store.js";
import { SalesCollections } from "./collections.js";
import type { AppRecordsStore } from "../../finance/core/app-records-store.js";

const logger = createLogger("CrmSyncService");

class CrmSyncService {
  private orgId: number;
  private store: AppRecordsStore | null = null;

  constructor(orgId: number) {
    this.orgId = orgId;
  }

  private async getStore(): Promise<AppRecordsStore> {
    if (!this.store) {
      this.store = await salesStoreForOrg(this.orgId);
    }
    return this.store;
  }

  async sync(objectType: string, objects: any[]) {
    const crm = await this.getConnectedCrm();
    if (!crm) {
      logger.warn(`[CrmSyncService] No CRM configured for org ${this.orgId}`);
      return;
    }

    for (const obj of objects) {
      await this.syncObject(crm, objectType, obj);
    }
  }

  /** Merge `fields` into an existing sales record (by collection + id) and persist it. */
  private async linkExternalId(collection: string, recordId: string | number, fields: Record<string, any>) {
    const store = await this.getStore();
    const id = String(recordId);
    const existing = await store.get(collection, id);
    if (!existing) {
      logger.warn(`[CrmSyncService] No ${collection} record ${id} found to link CRM id`, { fields });
      return;
    }
    await store.upsert(collection, id, { ...existing.data, ...fields });
  }

  private async syncObject(crm: any, objectType: string, obj: any) {
    if (crm.platform === "hubspot") {
      await this.syncHubspotObject(crm, objectType, obj);
    } else if (crm.platform === "salesforce") {
      await this.syncSalesforceObject(crm, objectType, obj);
    }
  }

  private async syncHubspotObject(crm: any, objectType: string, obj: any) {
    if (objectType === "Contact") {
      const hubspotContact = {
        email: obj.email,
        firstname: obj.firstName,
        lastname: obj.lastName,
        company: obj.company,
      };

      if (obj.hubspotContactId) {
        await crm.updateContact(obj.hubspotContactId, hubspotContact);
      } else {
        const newContact = await crm.createContact(hubspotContact);
        if (newContact.success && newContact.contactId) {
          await this.linkExternalId(SalesCollections.leads, obj.id, { hubspotContactId: newContact.contactId });
        }
      }
    } else if (objectType === "Deal") {
      const hubspotDeal = {
        dealname: obj.name,
        amount: obj.amount,
        dealstage: obj.stage,
      };

      if (obj.hubspotDealId) {
        await crm.updateDeal(obj.hubspotDealId, hubspotDeal);
      } else {
        const newDeal = await crm.createDeal(hubspotDeal);
        if (newDeal.success && newDeal.dealId) {
          await this.linkExternalId(SalesCollections.opportunities, obj.id, { hubspotDealId: newDeal.dealId });
        }
      }
    }
  }

  private async syncSalesforceObject(crm: any, objectType: string, obj: any) {
    if (objectType === "Lead") {
      const salesforceLead = {
        Email: obj.email,
        FirstName: obj.firstName,
        LastName: obj.lastName,
        Company: obj.company,
      };

      if (obj.salesforceLeadId) {
        await crm.updateRecord("Lead", obj.salesforceLeadId, salesforceLead);
      } else {
        const newLead = await crm.createRecord("Lead", salesforceLead);
        if (newLead.success && newLead.id) {
          await this.linkExternalId(SalesCollections.leads, obj.id, { salesforceLeadId: newLead.id });
        }
      }
    } else if (objectType === "Opportunity") {
      const salesforceOpportunity = {
        Name: obj.name,
        Amount: obj.amount,
        StageName: obj.stage,
      };

      if (obj.salesforceOpportunityId) {
        await crm.updateRecord("Opportunity", obj.salesforceOpportunityId, salesforceOpportunity);
      } else {
        const newOpportunity = await crm.createRecord("Opportunity", salesforceOpportunity);
        if (newOpportunity.success && newOpportunity.id) {
          await this.linkExternalId(SalesCollections.opportunities, obj.id, { salesforceOpportunityId: newOpportunity.id });
        }
      }
    }
  }

  private async getConnectedCrm(): Promise<any | null> {
    const [connector] = await db.select().from(saasConnectors)
      .where(and(eq(saasConnectors.orgId, this.orgId), eq(saasConnectors.status, "connected")))
      .limit(1);

    if (!connector) return null;

    if (connector.platform === "hubspot") {
      await hubspotConnector.loadFromPlatform(this.orgId);
      return hubspotConnector;
    }

    if (connector.platform === "salesforce") {
      await salesforceConnector.loadFromPlatform(this.orgId);
      return salesforceConnector;
    }

    return null;
  }
}

export { CrmSyncService };