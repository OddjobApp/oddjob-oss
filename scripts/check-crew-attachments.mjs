import { db } from "../server/database_service.ts";
import { crewSessions, crewAttachments, fileBlobs } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

const sessionKey = "crew-1786919778307-ttrb1xs";

async function main() {
  console.log(`Checking attachments for CREW room: ${sessionKey}`);
  
  const [session] = await db
    .select()
    .from(crewSessions)
    .where(eq(crewSessions.sessionKey, sessionKey))
    .limit(1);

  if (!session) {
    console.log("SESSION NOT FOUND");
    return;
  }

  console.log("Session found:", {
    id: session.id,
    organizationId: session.organizationId,
    projectId: session.projectId,
    mode: session.mode
  });

  if (!session.projectId) {
    console.log("\n⚠️  This room is NOT in a project space - attachments cannot be stored here!");
    console.log("   Attachments require a project scope for proper storage and access control.");
    return;
  }

  const attachments = await db
    .select({
      attachment: crewAttachments,
      blob: fileBlobs
    })
    .from(crewAttachments)
    .leftJoin(fileBlobs, eq(crewAttachments.blobId, fileBlobs.id))
    .where(eq(crewAttachments.sessionId, session.id))
    .orderBy(desc(crewAttachments.createdAt));

  console.log(`\nAttachments found: ${attachments.length}`);
  
  if (attachments.length === 0) {
    console.log("No attachments in this room yet.");
    console.log("To add attachments:");
    console.log("1. Use the 'Attach files' button in the CREW chat interface");
    console.log("2. Files will be stored in the project-scoped attachment system");
    console.log("3. They will be automatically parsed and indexed for search");
  } else {
    for (const { attachment, blob } of attachments) {
      console.log(`\n📎 ${attachment.displayName}`);
      console.log(`   ID: ${attachment.id}`);
      console.log(`   Blob ID: ${attachment.blobId}`);
      console.log(`   Uploaded by: ${attachment.uploadedBy}`);
      console.log(`   Created: ${attachment.createdAt}`);
      console.log(`   Blob status: ${blob?.parseStatus || 'unknown'}`);
      console.log(`   Blob size: ${blob?.byteSize || 'unknown'} bytes`);
    }
  }

  console.log(`\n📍 API Endpoint: GET /api/crew/${sessionKey}/attachments`);
  console.log(`📍 Upload Endpoint: POST /api/crew/${sessionKey}/attachments`);
  console.log(`📍 Download: GET /api/crew/${sessionKey}/attachments/:id/download`);
}

main().catch(console.error);