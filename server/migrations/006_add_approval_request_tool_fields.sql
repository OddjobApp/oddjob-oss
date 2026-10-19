-- Add toolName and toolArgs to approval_requests table

ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "tool_name" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "tool_args" jsonb;
