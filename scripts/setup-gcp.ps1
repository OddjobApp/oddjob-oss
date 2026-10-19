# setup-gcp.ps1 - Initialize GCP resources for Oddjob (Windows PowerShell version)

# Configuration
$PROJECT_ID = "oddjob-483505"
$REGION = "us-central1"
$BILLING_ACCOUNT = "0153CF-7AEE70-A3B29D"
$REPO_NAME = "oddjob-repo"
$DB_INSTANCE = "oddjob-db"
$REDIS_INSTANCE = "oddjob-redis"
$VPC_NAME = "oddjob-vpc"
$CONNECTOR_NAME = "oddjob-vpc-connector"

Write-Host "🚀 Starting Oddjob GCP Setup..." -ForegroundColor Cyan

# 1. Setup Project and Billing
gcloud config set project $PROJECT_ID
gcloud beta billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT

# 2. Enable Required APIs
Write-Host "Enabling APIs..."
gcloud services enable `
    run.googleapis.com `
    sqladmin.googleapis.com `
    redis.googleapis.com `
    secretmanager.googleapis.com `
    artifactregistry.googleapis.com `
    cloudbuild.googleapis.com `
    vpcaccess.googleapis.com `
    compute.googleapis.com `
    dns.googleapis.com

# 3. Create Artifact Registry
Write-Host "Creating Artifact Registry..."
gcloud artifacts repositories create $REPO_NAME `
    --repository-format=docker `
    --location=$REGION `
    --description="Oddjob Container Images"

# 4. Networking: VPC and Access Connector
Write-Host "Setting up VPC Networking..."
gcloud compute networks create $VPC_NAME --subnet-mode=custom
gcloud compute networks subnets create oddjob-subnet `
    --network=$VPC_NAME `
    --range=10.0.0.0/24 `
    --region=$REGION

gcloud compute networks vpc-access connectors create $CONNECTOR_NAME `
    --region=$REGION `
    --network=$VPC_NAME `
    --range=10.8.0.0/28

# 5. Database: Cloud SQL
Write-Host "Creating Cloud SQL Instance..."
gcloud sql instances create $DB_INSTANCE `
    --database-version=POSTGRES_15 `
    --tier=db-f1-micro `
    --region=$REGION `
    --network=$VPC_NAME `
    --no-assign-ip

# 6. Cache: MemoryStore Redis
Write-Host "Creating MemoryStore Redis..."
gcloud redis instances create $REDIS_INSTANCE `
    --size=1 `
    --region=$REGION `
    --network=$VPC_NAME `
    --connect-mode=PRIVATE_SERVICE_ACCESS

# 7. Secrets: Initialize Secret Manager
Write-Host "Initializing Secret Manager items..."
$secrets = @(
    "DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "JWT_SECRET_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ADMIN_EMAIL",
    "FROM_EMAIL"
)

foreach ($secret in $secrets) {
    gcloud secrets create $secret --replication-policy="automatic"
}

Write-Host "✅ Basic infrastructure scaffolding done." -ForegroundColor Green
Write-Host "⚠️  Next Steps: Populated secrets in GCP console and trigger the Cloud Build."
