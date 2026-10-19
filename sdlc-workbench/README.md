# SDLC Workbench

A modern procurement and vendor management workbench built with Next.js, featuring performance optimizations, API versioning, and enterprise-ready infrastructure.

## Features

- **Performance Optimizations**
  - React.memo for component memoization
  - useCallback for stable callback references
  - Lazy loading for AgentChat component
  - Skeleton loading states for tables

- **API Infrastructure**
  - API versioning (`/api/v1/`)
  - Zod schema validation
  - Structured error logging
  - Rate limiting (10 requests/minute per IP)
  - Health check endpoint

- **Security & Auth**
  - Authentication middleware (JWT/OAuth ready)
  - Authorization middleware (role-based)
  - Permission-based access control

- **Database Integration**
  - PostgreSQL-ready schema definitions
  - Database connection utilities
  - Migration support

- **Blueprint Execution**
  - Blueprint execution service integration
  - Mission tracking and status monitoring
  - Procurement and vendor cycle support

## Prerequisites

- Node.js 18+ 
- PostgreSQL 14+ (for production)
- Redis (optional, for production rate limiting)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd sdlc-workbench
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Configure your environment variables in `.env.local`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=oddjob
DB_USER=postgres
DB_PASSWORD=your_database_password
AUTH_SECRET=your_auth_secret_key
BLUEPRINT_BASE_URL=http://localhost:3000/api/blueprints
```

## Database Setup

### Development (Optional)
For development, the application uses mock data. To enable database integration:

1. Create a PostgreSQL database:
```sql
CREATE DATABASE oddjob;
```

2. Run database initialization:
```bash
npm run db:init
```

### Production
1. Set up PostgreSQL database
2. Configure environment variables
3. Run migrations:
```bash
npm run db:migrate
```

## Authentication Setup

### Development
Use mock tokens for testing:
- `mock-admin-token` - Full admin access
- `mock-manager-token` - Manager access
- `mock-user-token` - Read-only access

### Production
Choose an authentication provider:

**Option 1: JWT**
```env
AUTH_PROVIDER=jwt
AUTH_SECRET=your_jwt_secret
```

**Option 2: OAuth**
```env
AUTH_PROVIDER=oauth
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret
OAUTH_CALLBACK_URL=http://yourdomain.com/api/auth/callback
```

## Running the Application

### Development
```bash
npm run dev
```
Access at: http://localhost:3000

### Production
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /api/health` - Health status check

### v1 API Routes
- `POST /api/v1/procurement/purchase-request` - Submit purchase request
- `POST /api/v1/procurement/approval` - Submit procurement approval
- `POST /api/v1/vendor/onboarding` - Submit vendor onboarding
- `POST /api/v1/vendor/review` - Submit vendor review

### Authentication Headers
```
Authorization: Bearer <your_token>
```

## Rate Limiting

- Default: 10 requests per minute per IP
- Production: Configure Redis for distributed rate limiting
- Status code 429 returned when limit exceeded

## Error Handling

All API errors include:
- Timestamp
- Context
- Error details
- Request ID for tracking

Example error response:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": ["requester_name"],
      "message": "Required"
    }
  ],
  "requestId": "PR-1718300000000"
}
```

## Blueprint Integration

The application integrates with blueprint execution services to trigger operational missions:

**Supported Blueprints:**
- Procurement Management (purchase-request, approval)
- Vendor Management (onboarding, review)

**Configuration:**
```env
BLUEPRINT_BASE_URL=http://localhost:3000/api/blueprints
BLUEPRINT_API_KEY=your_api_key
```

## Workbenches

### Procurement Workbench
- Purchase request submission
- Approval workflow
- Real-time metrics
- Agent chat integration

### Vendor Workbench
- Vendor onboarding
- Performance review
- Compliance tracking
- Agent chat integration

## Performance Monitoring

The application includes:
- Structured error logging
- Request tracking IDs
- Health check endpoint
- Performance metrics

## Deployment

### Vercel
```bash
vercel deploy
```

### Docker
```bash
docker build -t sdlc-workbench .
docker run -p 3000:3000 sdlc-workbench
```

### Manual
1. Build the application: `npm run build`
2. Start the server: `npm start`
3. Configure reverse proxy (nginx, Apache)

## Environment Variables Reference

See `.env.example` for complete list of required environment variables.

## Troubleshooting

### Database Connection Issues
- Verify PostgreSQL is running
- Check connection credentials in `.env.local`
- Ensure database exists

### Authentication Failures
- Verify AUTH_SECRET is set
- Check token format in Authorization header
- Review auth provider configuration

### Blueprint Execution Errors
- Verify BLUEPRINT_BASE_URL is accessible
- Check BLUEPRINT_API_KEY is valid
- Review blueprint service logs

## License

[Your License Here]

## Support

For issues and questions, please open an issue on the repository.
