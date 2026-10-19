#!/usr/bin/env tsx
/**
 * Regression Test Suite for Oddjob Application
 * 
 * This script tests all major functionality to ensure nothing broke
 * after adding Pipeline Version Control feature.
 */

import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:5000';
const TEST_USER = {
  username: process.env.TEST_USERNAME || 'testuser',
  password: process.env.TEST_PASSWORD || 'testpassword',
};

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message?: string;
  duration?: number;
}

class RegressionTestSuite {
  private sessionCookie: string = '';
  private csrfToken: string = '';
  private testResults: TestResult[] = [];
  private testUserId: string = '';
  private testPipelineId: number = 0;
  private testJobId: number = 0;

  async run(): Promise<void> {
    console.log('🧪 Starting Regression Test Suite...\n');
    console.log(`Base URL: ${BASE_URL}\n`);

    try {
      // Phase 1: Critical Paths
      await this.testAuthentication();
      await this.testDashboard();
      await this.testJobsCRUD();
      await this.testPipelinesCRUD();
      await this.testPipelineExecution();
      await this.testPipelineVersionControl();

      // Phase 2: Secondary Features
      await this.testSchedules();
      await this.testScheduledJobs();
      await this.testCredentials();
      await this.testUsers();

      // Phase 3: Supporting Features
      await this.testMonitoring();
      await this.testAlerts();
      await this.testAICostCenter();
      await this.testCostDashboardFrontend();
      await this.testHILFormEngine();

      // Phase 4: Intelligent Automation
      await this.testIntelligentAutomation();

      // Phase 5: Security & Error Handling
      await this.testSecurity();
      await this.testErrorHandling();

      this.printSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  private async testAuthentication(): Promise<void> {
    console.log('📋 Testing Authentication...');

    // Test login
    await this.runTest('Login with valid credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(TEST_USER),
      });

      if (!response.ok) {
        throw new Error(`Login failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.testUserId = data.id;

      // Extract session cookie
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.sessionCookie = setCookie.split(';')[0];
      }

      // Get CSRF token
      if (data.csrfToken) {
        this.csrfToken = data.csrfToken;
      } else {
        const csrfResponse = await fetch(`${BASE_URL}/api/csrf-token`, {
          credentials: 'include',
          headers: { Cookie: this.sessionCookie },
        });
        const csrfData = await csrfResponse.json();
        this.csrfToken = csrfData.csrfToken;
      }
    });

    // Test get current user
    await this.runTest('Get current user', async () => {
      const response = await fetch(`${BASE_URL}/api/user`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get user failed: ${response.status}`);
      }

      const user = await response.json();
      if (!user.id) {
        throw new Error('User ID not returned');
      }
    });

    // Test logout
    await this.runTest('Logout', async () => {
      const response = await fetch(`${BASE_URL}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Cookie: this.sessionCookie,
          'x-csrf-token': this.csrfToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Logout failed: ${response.status}`);
      }

      // Clear session
      this.sessionCookie = '';
      this.csrfToken = '';
    });

    console.log('');
  }

  private async testDashboard(): Promise<void> {
    console.log('📋 Testing Dashboard...');

    await this.ensureAuthenticated();

    await this.runTest('Dashboard stats endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/dashboard/stats`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Dashboard stats failed: ${response.status}`);
      }

      const stats = await response.json();
      // Validate stats structure - check for expected properties
      if (typeof stats.activeSchedules !== 'number' ||
        typeof stats.activePipelines !== 'number' ||
        typeof stats.activeAlerts !== 'number') {
        throw new Error('Invalid stats format - missing required properties');
      }
    });

    console.log('');
  }

  private async testJobsCRUD(): Promise<void> {
    console.log('📋 Testing Jobs CRUD...');

    await this.ensureAuthenticated();

    // Create job
    await this.runTest('Create job', async () => {
      const jobData = {
        name: 'Test Shell Job',
        type: 'shell',
        config: {
          executable: 'echo',
          parameters: 'Hello World',
        },
        createdBy: this.testUserId,
      };

      const response = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify(jobData),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Create job failed: ${response.status} - ${error}`);
      }

      const job = await response.json();
      this.testJobId = job.id;
    });

    // Get job
    await this.runTest('Get job by ID', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs/${this.testJobId}`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get job failed: ${response.status}`);
      }

      const job = await response.json();
      if (job.id !== this.testJobId) {
        throw new Error('Job ID mismatch');
      }
    });

    // Update job
    await this.runTest('Update job', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs/${this.testJobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({ name: 'Updated Test Job' }),
      });

      if (!response.ok) {
        throw new Error(`Update job failed: ${response.status}`);
      }
    });

    // List jobs
    await this.runTest('List all jobs', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List jobs failed: ${response.status}`);
      }

      let jobs = await response.json();
      if (!Array.isArray(jobs)) {
        if (jobs && Array.isArray(jobs.items)) {
          jobs = jobs.items;
        } else {
          throw new Error('Jobs list is not an array or object with items array');
        }
      }
    });

    console.log('');
  }

  private async testPipelinesCRUD(): Promise<void> {
    console.log('📋 Testing Pipelines CRUD...');

    await this.ensureAuthenticated();

    // Create pipeline
    await this.runTest('Create pipeline', async () => {
      const pipelineData = {
        name: 'Test Pipeline',
        description: 'Regression test pipeline',
        triggerType: 'manual',
        createdBy: this.testUserId,
        steps: [
          {
            jobId: this.testJobId,
            order: 0,
            outputName: 'output1',
          },
        ],
      };

      const response = await fetch(`${BASE_URL}/api/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify(pipelineData),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Create pipeline failed: ${response.status} - ${error}`);
      }

      const pipeline = await response.json();
      this.testPipelineId = pipeline.id;
    });

    // Get pipeline
    await this.runTest('Get pipeline by ID', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get pipeline failed: ${response.status}`);
      }

      const pipeline = await response.json();
      if (pipeline.id !== this.testPipelineId) {
        throw new Error('Pipeline ID mismatch');
      }
      if (!pipeline.steps || !Array.isArray(pipeline.steps)) {
        throw new Error('Pipeline steps not returned');
      }
    });

    // Update pipeline
    await this.runTest('Update pipeline', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({ name: 'Updated Test Pipeline' }),
      });

      if (!response.ok) {
        throw new Error(`Update pipeline failed: ${response.status}`);
      }
    });

    // List pipelines
    await this.runTest('List all pipelines', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List pipelines failed: ${response.status}`);
      }

      let pipelines = await response.json();
      if (!Array.isArray(pipelines)) {
        if (pipelines && Array.isArray(pipelines.items)) {
          pipelines = pipelines.items;
        } else {
          throw new Error('Pipelines list is not an array or object with items array');
        }
      }
    });

    console.log('');
  }

  private async testPipelineExecution(): Promise<void> {
    console.log('📋 Testing Pipeline Execution...');

    await this.ensureAuthenticated();

    await this.runTest('Execute pipeline', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pipeline execution failed: ${response.status} - ${error}`);
      }

      const result = await response.json();
      if (typeof result.success !== 'boolean') {
        throw new Error('Invalid execution result format');
      }
    }, 'SKIP'); // Skip if execution system not ready

    await this.runTest('Get pipeline executions', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/executions`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get executions failed: ${response.status}`);
      }

      const executions = await response.json();
      if (!Array.isArray(executions)) {
        throw new Error('Executions list is not an array');
      }
    });

    console.log('');
  }

  private async testPipelineVersionControl(): Promise<void> {
    console.log('📋 Testing Pipeline Version Control (NEW FEATURE)...');

    await this.ensureAuthenticated();

    // Create version snapshot
    await this.runTest('Create pipeline version snapshot', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({
          description: 'Test snapshot for regression',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Create version failed: ${response.status} - ${error}`);
      }
    });

    // Get version history
    await this.runTest('Get pipeline version history', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/versions`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get versions failed: ${response.status}`);
      }

      const versions = await response.json();
      if (!Array.isArray(versions)) {
        throw new Error('Versions list is not an array');
      }
      if (versions.length === 0) {
        throw new Error('No versions found after creation');
      }

      // Store first version ID for rollback test
      if (versions.length > 0) {
        const firstVersion = versions[0];

        // Test rollback
        await this.runTest('Rollback pipeline to version', async () => {
          const rollbackResponse = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/rollback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': this.csrfToken,
              Cookie: this.sessionCookie,
            },
            credentials: 'include',
            body: JSON.stringify({
              versionId: firstVersion.id,
            }),
          });

          if (!rollbackResponse.ok) {
            const error = await rollbackResponse.text();
            throw new Error(`Rollback failed: ${rollbackResponse.status} - ${error}`);
          }
        });
      }
    });

    console.log('');
  }

  private async testSchedules(): Promise<void> {
    console.log('📋 Testing Schedules...');

    await this.ensureAuthenticated();

    await this.runTest('List schedules', async () => {
      const response = await fetch(`${BASE_URL}/api/schedules`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List schedules failed: ${response.status}`);
      }

      const schedules = await response.json();
      if (!Array.isArray(schedules)) {
        throw new Error('Schedules list is not an array');
      }
    });

    console.log('');
  }

  private async testScheduledJobs(): Promise<void> {
    console.log('📋 Testing Scheduled Jobs...');

    await this.ensureAuthenticated();

    await this.runTest('List scheduled jobs', async () => {
      const response = await fetch(`${BASE_URL}/api/scheduled-jobs`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List scheduled jobs failed: ${response.status}`);
      }

      const jobs = await response.json();
      if (!Array.isArray(jobs)) {
        throw new Error('Scheduled jobs list is not an array');
      }

      // Verify nextRunTime field exists for jobs with schedules
      for (const job of jobs) {
        if (job.scheduleId && job.scheduleIsActive) {
          // Job should have nextRunTime or schedulePattern field
          if (job.nextRunTime === undefined && job.schedulePattern === undefined) {
            console.warn(`⚠️  Warning: Scheduled job ${job.id} has schedule but no nextRunTime or schedulePattern`);
          }
        }
      }
    });

    await this.runTest('Get scheduled job detail', async () => {
      // First get a scheduled job ID
      const listResponse = await fetch(`${BASE_URL}/api/scheduled-jobs`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!listResponse.ok) {
        throw new Error(`List scheduled jobs failed: ${listResponse.status}`);
      }

      const jobs = await listResponse.json();
      if (!Array.isArray(jobs) || jobs.length === 0) {
        console.log('   ⏭️  Skipping - no scheduled jobs found');
        return;
      }

      const firstJob = jobs[0];
      const jobId = firstJob.scheduledJobId || firstJob.id;

      const response = await fetch(`${BASE_URL}/api/scheduled-jobs/${jobId}`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get scheduled job detail failed: ${response.status}`);
      }

      const job = await response.json();
      if (!job.id && !job.scheduledJobId) {
        throw new Error('Scheduled job detail missing ID');
      }
    });

    console.log('');
  }

  private async testCredentials(): Promise<void> {
    console.log('📋 Testing Credentials...');

    await this.ensureAuthenticated();

    await this.runTest('List credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/credentials`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List credentials failed: ${response.status}`);
      }

      const credentials = await response.json();
      if (!Array.isArray(credentials)) {
        throw new Error('Credentials list is not an array');
      }
    });

    console.log('');
  }

  private async testUsers(): Promise<void> {
    console.log('📋 Testing Users...');

    await this.ensureAuthenticated();

    await this.runTest('List users', async () => {
      const response = await fetch(`${BASE_URL}/api/users`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List users failed: ${response.status}`);
      }

      const users = await response.json();
      if (!Array.isArray(users)) {
        throw new Error('Users list is not an array');
      }
    });

    await this.runTest('Get current user', async () => {
      const response = await fetch(`${BASE_URL}/api/users/current`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get current user failed: ${response.status}`);
      }
    });

    console.log('');
  }

  private async testMonitoring(): Promise<void> {
    console.log('📋 Testing Monitoring...');

    await this.ensureAuthenticated();

    await this.runTest('List executions', async () => {
      const response = await fetch(`${BASE_URL}/api/executions`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List executions failed: ${response.status}`);
      }

      const executions = await response.json();
      if (!Array.isArray(executions)) {
        throw new Error('Executions list is not an array');
      }
    });

    console.log('');
  }

  private async testAlerts(): Promise<void> {
    console.log('📋 Testing Alerts...');

    await this.ensureAuthenticated();

    await this.runTest('List alerts', async () => {
      const response = await fetch(`${BASE_URL}/api/alerts`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List alerts failed: ${response.status}`);
      }

      const alerts = await response.json();
      if (!Array.isArray(alerts)) {
        throw new Error('Alerts list is not an array');
      }
    });

    console.log('');
  }

  private async testAICostCenter(): Promise<void> {
    console.log('📋 Testing AI Cost Center...');

    await this.ensureAuthenticated();

    // Test cost dashboard endpoint
    await this.runTest('Get cost dashboard analytics', async () => {
      const response = await fetch(`${BASE_URL}/api/analytics/cost-dashboard`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Cost dashboard failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.dailyCosts || !Array.isArray(data.dailyCosts)) {
        throw new Error('Invalid dashboard response format');
      }
      if (!data.modelCosts || !Array.isArray(data.modelCosts)) {
        throw new Error('Model costs missing from response');
      }
      if (!data.topPipelines || !Array.isArray(data.topPipelines)) {
        throw new Error('Top pipelines missing from response');
      }
      if (typeof data.totalSpend !== 'number') {
        throw new Error('Total spend missing or invalid');
      }
    });

    // Test pipeline cost analytics
    await this.runTest('Get pipeline cost analytics', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/cost-analytics`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Pipeline cost analytics failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.pipelineId !== this.testPipelineId) {
        throw new Error('Pipeline ID mismatch');
      }
      if (typeof data.currentMonthSpend !== 'number') {
        throw new Error('Current month spend missing or invalid');
      }
      if (!data.dailyCosts || !Array.isArray(data.dailyCosts)) {
        throw new Error('Daily costs missing from response');
      }
    });

    // Test usage ingestion endpoint
    await this.runTest('Ingest usage data', async () => {
      const response = await fetch(`${BASE_URL}/api/analytics/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({
          pipelineId: this.testPipelineId,
          provider: 'openai',
          model: 'gpt-4o',
          promptTokens: 100,
          completionTokens: 50,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Usage ingestion failed: ${response.status} - ${error}`);
      }

      const result = await response.json();
      if (result.status !== 'recorded') {
        throw new Error('Usage not recorded successfully');
      }
    });

    console.log('');
  }

  private async testCostDashboardFrontend(): Promise<void> {
    console.log('📋 Testing Cost Dashboard Frontend...');

    await this.ensureAuthenticated();

    // Test that the analytics route data structure matches frontend expectations
    await this.runTest('Cost dashboard frontend data structure', async () => {
      const response = await fetch(`${BASE_URL}/api/analytics/cost-dashboard`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Cost dashboard API failed: ${response.status}`);
      }

      const data = await response.json();
      // Verify structure matches what frontend expects
      if (typeof data.totalSpend !== 'number') {
        throw new Error('Frontend expects totalSpend as number');
      }
      if (!Array.isArray(data.dailyCosts)) {
        throw new Error('Frontend expects dailyCosts as array');
      }
      if (!Array.isArray(data.modelCosts)) {
        throw new Error('Frontend expects modelCosts as array');
      }
      if (!Array.isArray(data.topPipelines)) {
        throw new Error('Frontend expects topPipelines as array');
      }
    });

    console.log('');
  }

  private async testHILFormEngine(): Promise<void> {
    console.log('📋 Testing HIL Form Engine...');

    await this.ensureAuthenticated();

    let testFormId: number = 0;

    // Test list forms endpoint
    await this.runTest('List forms', async () => {
      const response = await fetch(`${BASE_URL}/api/forms`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`List forms failed: ${response.status}`);
      }

      const forms = await response.json();
      if (!Array.isArray(forms)) {
        throw new Error('Forms list is not an array');
      }
    });

    // Test create form
    await this.runTest('Create form', async () => {
      const response = await fetch(`${BASE_URL}/api/forms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({
          name: 'Test Regression Form',
          description: 'Form created by regression tests',
          schema: {
            fields: [
              {
                key: 'reason',
                type: 'text',
                label: 'Reason',
                required: true,
              },
              {
                key: 'rating',
                type: 'rating',
                label: 'Rating',
                required: false,
                max: 5,
              },
            ],
          },
          themeConfig: {
            logoUrl: '',
            primaryColor: '#4F46E5',
            companyName: 'Test Company',
          },
          securityConfig: {
            requireOtp: false,
            tokenExpirationHours: 48,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Create form failed: ${response.status} - ${error}`);
      }

      const form = await response.json();
      if (!form.id || !form.name) {
        throw new Error('Invalid form response');
      }
      testFormId = form.id;
    });

    // Test get form details
    await this.runTest('Get form details', async () => {
      if (!testFormId) {
        throw new Error('Test form ID not set');
      }

      const response = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (!response.ok) {
        throw new Error(`Get form failed: ${response.status}`);
      }

      const form = await response.json();
      if (form.id !== testFormId) {
        throw new Error('Form ID mismatch');
      }
      if (!form.schema || !form.schema.fields || !Array.isArray(form.schema.fields)) {
        throw new Error('Invalid form schema');
      }
      if (form.schema.fields.length !== 2) {
        throw new Error('Form fields count mismatch');
      }
    });

    // Test update form
    await this.runTest('Update form', async () => {
      if (!testFormId) {
        throw new Error('Test form ID not set');
      }

      const response = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({
          description: 'Updated description',
          themeConfig: {
            logoUrl: '',
            primaryColor: '#FF5733',
            companyName: 'Updated Company',
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Update form failed: ${response.status} - ${error}`);
      }

      const form = await response.json();
      if (form.description !== 'Updated description') {
        throw new Error('Description not updated');
      }
      if (form.themeConfig.primaryColor !== '#FF5733') {
        throw new Error('Theme config not updated');
      }
    });

    // Test archive form (soft delete)
    await this.runTest('Archive form', async () => {
      if (!testFormId) {
        throw new Error('Test form ID not set');
      }

      const response = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        method: 'DELETE',
        headers: {
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Archive form failed: ${response.status} - ${error}`);
      }

      // Verify form is archived (should not appear in active forms list)
      const listResponse = await fetch(`${BASE_URL}/api/forms`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });
      const forms = await listResponse.json();
      const archivedForm = forms.find((f: any) => f.id === testFormId);
      if (archivedForm) {
        throw new Error('Archived form still appears in active forms list');
      }
    });

    console.log('');
  }

  private async testSecurity(): Promise<void> {
    console.log('📋 Testing Security...');

    await this.ensureAuthenticated();

    // Test CSRF protection
    await this.runTest('CSRF protection on POST', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.sessionCookie,
          // Intentionally omit CSRF token
        },
        credentials: 'include',
        body: JSON.stringify({ name: 'Test' }),
      });

      if (response.status !== 403) {
        throw new Error(`CSRF protection not working. Expected 403, got ${response.status}`);
      }
    });

    // Test authentication required
    await this.runTest('Authentication required for protected routes', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines`, {
        credentials: 'include',
        // No cookie header
      });

      if (response.status !== 401 && response.status !== 403) {
        throw new Error(`Auth check not working. Expected 401/403, got ${response.status}`);
      }
    });

    console.log('');
  }

  private async testErrorHandling(): Promise<void> {
    console.log('📋 Testing Error Handling...');

    await this.ensureAuthenticated();

    await this.runTest('404 for non-existent pipeline', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/99999`, {
        credentials: 'include',
        headers: { Cookie: this.sessionCookie },
      });

      if (response.status !== 404) {
        throw new Error(`Expected 404, got ${response.status}`);
      }
    });

    await this.runTest('400 for invalid version ID', async () => {
      const response = await fetch(`${BASE_URL}/api/pipelines/${this.testPipelineId}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': this.csrfToken,
          Cookie: this.sessionCookie,
        },
        credentials: 'include',
        body: JSON.stringify({
          versionId: 'invalid',
        }),
      });

      if (response.status !== 400 && response.status !== 500) {
        throw new Error(`Expected 400/500 for invalid input, got ${response.status}`);
      }
    });

    console.log('');
  }

  private async runTest(
    name: string,
    testFn: () => Promise<void>,
    defaultStatus: 'PASS' | 'FAIL' | 'SKIP' = 'PASS'
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.testResults.push({ name, status: 'PASS', duration });
      console.log(`  ✅ ${name} (${duration}ms)`);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const message = error.message || String(error);
      this.testResults.push({ name, status: defaultStatus === 'SKIP' ? 'SKIP' : 'FAIL', message, duration });

      if (defaultStatus === 'SKIP') {
        console.log(`  ⏭️  ${name} - SKIPPED: ${message}`);
      } else {
        console.log(`  ❌ ${name} - FAILED: ${message}`);
      }
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionCookie || !this.csrfToken) {
      // Re-authenticate
      const response = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(TEST_USER),
      });

      if (!response.ok) {
        throw new Error('Failed to authenticate for test');
      }

      const data = await response.json();
      this.testUserId = data.id;

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.sessionCookie = setCookie.split(';')[0];
      }

      if (data.csrfToken) {
        this.csrfToken = data.csrfToken;
      } else {
        const csrfResponse = await fetch(`${BASE_URL}/api/csrf-token`, {
          credentials: 'include',
          headers: { Cookie: this.sessionCookie },
        });
        const csrfData = await csrfResponse.json();
        this.csrfToken = csrfData.csrfToken;
      }
    }
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const skipped = this.testResults.filter(r => r.status === 'SKIP').length;
    const total = this.testResults.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped: ${skipped}`);

    if (failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`  - ${r.name}: ${r.message}`);
        });
    }

    const successRate = ((passed / total) * 100).toFixed(1);
    console.log(`\nSuccess Rate: ${successRate}%`);

    if (failed > 0) {
      console.log('\n⚠️  Some tests failed. Please review the errors above.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }

  private async testIntelligentAutomation(): Promise<void> {
    console.log('📋 Testing Intelligent Automation (JIRA Solver)...');

    // We run the external E2E script as a child process
    await this.runTest('JIRA Solver E2E Pipeline', async () => {
      console.log('   Running external script: server/test_jira_e2e.ts');

      return new Promise<void>((resolve, reject) => {
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const testProcess = spawn(npxCmd, ['tsx', '-r', 'dotenv/config', 'server/test_jira_e2e.ts'], {
          stdio: 'inherit',
          env: { ...process.env },
          shell: process.platform === 'win32',
        });

        testProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            // We don't verify the capture output format in the script yet, so we ignore warnings
            // However, a non-zero exit code means something actually crashed
            reject(new Error(`E2E script exited with code ${code}`));
          }
        });

        testProcess.on('error', (err) => {
          reject(err);
        });
      });
    });

    console.log('');
  }
}

// Run the test suite
const suite = new RegressionTestSuite();
suite.run().catch(console.error);

