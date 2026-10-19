import { db } from "../database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function findData() {
  const nodeResults = await db
    .select({ 
      missionId: knowledgeNodes.missionId, 
      count: sql<number>`count(*)` 
    })
    .from(knowledgeNodes)
    .groupBy(knowledgeNodes.missionId);
  
  const edgeResults = await db
    .select({ 
      missionId: knowledgeEdges.missionId, 
      count: sql<number>`count(*)` 
    })
    .from(knowledgeEdges)
    .groupBy(knowledgeEdges.missionId);

  console.log("Missions with knowledge nodes:");
  console.log(nodeResults);
  
  console.log("\nMissions with knowledge edges:");
  console.log(edgeResults);
}

findData().catch(console.error);

