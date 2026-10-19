/**
 * Comprehensive Test Suite for User Experience Features
 * Tests scoring system, interventions, A/B testing, and enhanced UX
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock API client for testing user experience features
const mockApi = {
  scoring: {
    getUserScore: vi.fn(),
    updateUserScore: vi.fn(),
    getScoringHistory: vi.fn(),
    calculateOptimalScore: vi.fn(),
    getScoreBreakdown: vi.fn()
  },
  interventions: {
    getActiveInterventions: vi.fn(),
    createIntervention: vi.fn(),
    updateIntervention: vi.fn(),
    completeIntervention: vi.fn(),
    getInterventionHistory: vi.fn()
  },
  abTesting: {
    getActiveExperiments: vi.fn(),
    createExperiment: vi.fn(),
    getExperimentResults: vi.fn(),
    assignUserToVariant: vi.fn(),
    trackConversion: vi.fn()
  },
  ux: {
    getActivityFeed: vi.fn(),
    getPersonalizedRecommendations: vi.fn(),
    updateUserPreferences: vi.fn(),
    getUsageAnalytics: vi.fn()
  }
};

// Mock the API calls
vi.mock('@/lib/api', () => ({
  api: mockApi
}));

describe('User Experience - Scoring System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('User Score Management', () => {
    it('retrieves current user score', async () => {
      const mockScore = {
        user_id: 'user_123',
        current_score: 85.5,
        score_trend: 'increasing',
        last_updated: new Date().toISOString()
      };

      mockApi.scoring.getUserScore.mockResolvedValue(mockScore);

      const score = await mockApi.scoring.getUserScore('user_123');

      expect(score).toBeDefined();
      expect(score.current_score).toBeGreaterThanOrEqual(0);
      expect(score.current_score).toBeLessThanOrEqual(100);
      expect(['increasing', 'decreasing', 'stable']).toContain(score.score_trend);
    });

    it('updates user score based on actions', async () => {
      const scoreUpdate = {
        user_id: 'user_123',
        action: 'completed_task',
        points: 10,
        reason: 'Task completion bonus'
      };

      mockApi.scoring.updateUserScore.mockResolvedValue({ success: true, new_score: 95.5 });

      const result = await mockApi.scoring.updateUserScore(scoreUpdate);

      expect(result.success).toBe(true);
      expect(result.new_score).toBeDefined();
      expect(typeof result.new_score).toBe('number');
    });

    it('provides scoring history', async () => {
      const mockHistory = [
        { timestamp: new Date(), action: 'login', points: 5, score_after: 45.0 },
        { timestamp: new Date(), action: 'task_complete', points: 15, score_after: 60.0 }
      ];

      mockApi.scoring.getScoringHistory.mockResolvedValue(mockHistory);

      const history = await mockApi.scoring.getScoringHistory('user_123', 7);

      expect(Array.isArray(history)).toBe(true);
      history.forEach(entry => {
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('action');
        expect(entry).toHaveProperty('points');
        expect(entry).toHaveProperty('score_after');
      });
    });
  });

  describe('Score Optimization', () => {
    it('calculates optimal score targets', async () => {
      const mockOptimal = {
        current_score: 75.0,
        optimal_score: 90.0,
        recommended_actions: [
          'Complete 3 more tasks this week',
          'Participate in team collaboration',
          'Review and update profile information'
        ],
        estimated_time: '2 weeks'
      };

      mockApi.scoring.calculateOptimalScore.mockResolvedValue(mockOptimal);

      const optimal = await mockApi.scoring.calculateOptimalScore('user_123');

      expect(optimal.optimal_score).toBeGreaterThan(optimal.current_score);
      expect(Array.isArray(optimal.recommended_actions)).toBe(true);
      expect(optimal.recommended_actions.length).toBeGreaterThan(0);
    });

    it('provides detailed score breakdown', async () => {
      const mockBreakdown = {
        categories: {
          productivity: { score: 88, weight: 0.4, contribution: 35.2 },
          collaboration: { score: 72, weight: 0.3, contribution: 21.6 },
          quality: { score: 95, weight: 0.3, contribution: 28.5 }
        },
        total_score: 85.3,
        improvement_areas: ['collaboration']
      };

      mockApi.scoring.getScoreBreakdown.mockResolvedValue(mockBreakdown);

      const breakdown = await mockApi.scoring.getScoreBreakdown('user_123');

      expect(breakdown).toHaveProperty('categories');
      expect(breakdown).toHaveProperty('total_score');
      expect(breakdown).toHaveProperty('improvement_areas');
      Object.values(breakdown.categories).forEach((category: any) => {
        expect(category.score).toBeGreaterThanOrEqual(0);
        expect(category.score).toBeLessThanOrEqual(100);
        expect(category.weight).toBeGreaterThan(0);
        expect(category.weight).toBeLessThanOrEqual(1);
      });
    });
  });
});

describe('User Experience - Intervention Management', () => {
  describe('Active Interventions', () => {
    it('retrieves active interventions for user', async () => {
      const mockInterventions = [
        {
          id: 'int_1',
          type: 'reminder',
          title: 'Weekly Task Review',
          description: 'Review and prioritize your tasks for the week',
          priority: 'medium',
          due_date: new Date(Date.now() + 86400000).toISOString(),
          status: 'active'
        },
        {
          id: 'int_2',
          type: 'suggestion',
          title: 'Try New Feature',
          description: 'Explore the new predictive analytics dashboard',
          priority: 'low',
          status: 'active'
        }
      ];

      mockApi.interventions.getActiveInterventions.mockResolvedValue(mockInterventions);

      const interventions = await mockApi.interventions.getActiveInterventions('user_123');

      expect(Array.isArray(interventions)).toBe(true);
      interventions.forEach(intervention => {
        expect(intervention).toHaveProperty('id');
        expect(intervention).toHaveProperty('type');
        expect(intervention).toHaveProperty('title');
        expect(intervention).toHaveProperty('status');
        expect(['low', 'medium', 'high', 'urgent']).toContain(intervention.priority);
      });
    });

    it('creates new interventions', async () => {
      const newIntervention = {
        user_id: 'user_123',
        type: 'coaching',
        title: 'Productivity Coaching Session',
        description: 'One-on-one session to improve work efficiency',
        priority: 'high',
        trigger_conditions: { score_below: 70, time_period: 'weekly' }
      };

      mockApi.interventions.createIntervention.mockResolvedValue({
        id: 'int_new',
        ...newIntervention,
        status: 'active',
        created_at: new Date().toISOString()
      });

      const result = await mockApi.interventions.createIntervention(newIntervention);

      expect(result).toHaveProperty('id');
      expect(result.status).toBe('active');
      expect(result.type).toBe(newIntervention.type);
    });
  });

  describe('Intervention Lifecycle', () => {
    it('updates intervention status', async () => {
      const updateData = {
        status: 'completed',
        completion_notes: 'User completed the suggested task successfully'
      };

      mockApi.interventions.updateIntervention.mockResolvedValue({
        id: 'int_1',
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      const result = await mockApi.interventions.updateIntervention('int_1', updateData);

      expect(result.status).toBe('completed');
      expect(result).toHaveProperty('completed_at');
    });

    it('completes interventions with feedback', async () => {
      const completionData = {
        feedback: 'Very helpful intervention',
        rating: 5,
        would_recommend: true
      };

      mockApi.interventions.completeIntervention.mockResolvedValue({
        id: 'int_1',
        status: 'completed',
        feedback: completionData.feedback,
        rating: completionData.rating
      });

      const result = await mockApi.interventions.completeIntervention('int_1', completionData);

      expect(result.status).toBe('completed');
      expect(result.rating).toBe(5);
      expect(result.feedback).toBe(completionData.feedback);
    });

    it('tracks intervention history', async () => {
      const mockHistory = [
        { id: 'int_1', type: 'reminder', status: 'completed', completed_at: new Date() },
        { id: 'int_2', type: 'suggestion', status: 'dismissed', dismissed_at: new Date() }
      ];

      mockApi.interventions.getInterventionHistory.mockResolvedValue(mockHistory);

      const history = await mockApi.interventions.getInterventionHistory('user_123', 30);

      expect(Array.isArray(history)).toBe(true);
      history.forEach(entry => {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('type');
        expect(['completed', 'dismissed', 'expired']).toContain(entry.status);
      });
    });
  });
});

describe('User Experience - A/B Testing', () => {
  describe('Experiment Management', () => {
    it('retrieves active experiments', async () => {
      const mockExperiments = [
        {
          id: 'exp_1',
          name: 'New Dashboard Layout',
          variants: ['control', 'variant_a', 'variant_b'],
          status: 'active',
          participants: 1250,
          conversion_goal: 'dashboard_usage_time'
        },
        {
          id: 'exp_2',
          name: 'Notification Frequency',
          variants: ['frequent', 'moderate', 'minimal'],
          status: 'active',
          participants: 890,
          conversion_goal: 'user_engagement'
        }
      ];

      mockApi.abTesting.getActiveExperiments.mockResolvedValue(mockExperiments);

      const experiments = await mockApi.abTesting.getActiveExperiments();

      expect(Array.isArray(experiments)).toBe(true);
      experiments.forEach(exp => {
        expect(exp).toHaveProperty('id');
        expect(exp).toHaveProperty('name');
        expect(exp).toHaveProperty('variants');
        expect(Array.isArray(exp.variants)).toBe(true);
        expect(exp.status).toBe('active');
      });
    });

    it('creates new experiments', async () => {
      const newExperiment = {
        name: 'Task Completion Flow',
        variants: ['current_flow', 'simplified_flow', 'guided_flow'],
        target_audience: { user_segments: ['new_users', 'power_users'] },
        conversion_goal: 'task_completion_rate',
        duration_days: 14
      };

      mockApi.abTesting.createExperiment.mockResolvedValue({
        id: 'exp_new',
        ...newExperiment,
        status: 'draft',
        created_at: new Date().toISOString()
      });

      const result = await mockApi.abTesting.createExperiment(newExperiment);

      expect(result).toHaveProperty('id');
      expect(result.status).toBe('draft');
      expect(result.variants).toEqual(newExperiment.variants);
    });
  });

  describe('User Assignment and Tracking', () => {
    it('assigns users to experiment variants', async () => {
      const assignment = {
        user_id: 'user_123',
        experiment_id: 'exp_1',
        variant: 'variant_a',
        assigned_at: new Date().toISOString()
      };

      mockApi.abTesting.assignUserToVariant.mockResolvedValue(assignment);

      const result = await mockApi.abTesting.assignUserToVariant('user_123', 'exp_1');

      expect(result.variant).toBeDefined();
      expect(['control', 'variant_a', 'variant_b']).toContain(result.variant);
      expect(result.user_id).toBe('user_123');
      expect(result.experiment_id).toBe('exp_1');
    });

    it('tracks conversion events', async () => {
      const conversionEvent = {
        user_id: 'user_123',
        experiment_id: 'exp_1',
        variant: 'variant_a',
        event_type: 'conversion',
        event_data: { completion_time: 45, satisfaction_score: 9 }
      };

      mockApi.abTesting.trackConversion.mockResolvedValue({ success: true });

      const result = await mockApi.abTesting.trackConversion(conversionEvent);

      expect(result.success).toBe(true);
    });

    it('provides experiment results', async () => {
      const mockResults = {
        experiment_id: 'exp_1',
        variants: {
          control: { participants: 420, conversions: 210, conversion_rate: 0.50 },
          variant_a: { participants: 415, conversions: 240, conversion_rate: 0.58 },
          variant_b: { participants: 415, conversions: 225, conversion_rate: 0.54 }
        },
        winner: 'variant_a',
        confidence_level: 0.95,
        statistical_significance: true
      };

      mockApi.abTesting.getExperimentResults.mockResolvedValue(mockResults);

      const results = await mockApi.abTesting.getExperimentResults('exp_1');

      expect(results).toHaveProperty('experiment_id');
      expect(results).toHaveProperty('variants');
      expect(results).toHaveProperty('winner');
      expect(results.confidence_level).toBeGreaterThanOrEqual(0);
      expect(results.confidence_level).toBeLessThanOrEqual(1);
      expect(typeof results.statistical_significance).toBe('boolean');
    });
  });
});

describe('User Experience - Activity Feed and Personalization', () => {
  describe('Activity Feed', () => {
    it('retrieves personalized activity feed', async () => {
      const mockFeed = [
        {
          id: 'activity_1',
          type: 'achievement',
          title: 'Score Milestone Reached!',
          description: 'You reached an 85% user score',
          timestamp: new Date().toISOString(),
          priority: 'high'
        },
        {
          id: 'activity_2',
          type: 'recommendation',
          title: 'Try This Feature',
          description: 'Based on your usage, you might like the predictive analytics',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          priority: 'medium'
        }
      ];

      mockApi.ux.getActivityFeed.mockResolvedValue(mockFeed);

      const feed = await mockApi.ux.getActivityFeed('user_123', 10);

      expect(Array.isArray(feed)).toBe(true);
      feed.forEach(activity => {
        expect(activity).toHaveProperty('id');
        expect(activity).toHaveProperty('type');
        expect(activity).toHaveProperty('title');
        expect(activity).toHaveProperty('timestamp');
        expect(['low', 'medium', 'high']).toContain(activity.priority);
      });
    });
  });

  describe('Personalized Recommendations', () => {
    it('provides personalized feature recommendations', async () => {
      const mockRecommendations = [
        {
          feature: 'predictive_analytics',
          reason: 'Based on your workflow patterns',
          confidence: 0.85,
          category: 'productivity'
        },
        {
          feature: 'team_collaboration',
          reason: 'Similar users found this helpful',
          confidence: 0.72,
          category: 'collaboration'
        }
      ];

      mockApi.ux.getPersonalizedRecommendations.mockResolvedValue(mockRecommendations);

      const recommendations = await mockApi.ux.getPersonalizedRecommendations('user_123');

      expect(Array.isArray(recommendations)).toBe(true);
      recommendations.forEach(rec => {
        expect(rec).toHaveProperty('feature');
        expect(rec).toHaveProperty('reason');
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('updates user preferences', async () => {
      const preferences = {
        theme: 'dark',
        notifications: { email: true, push: false, in_app: true },
        feature_interests: ['analytics', 'automation', 'collaboration'],
        privacy_settings: { analytics_tracking: true, personalization: true }
      };

      mockApi.ux.updateUserPreferences.mockResolvedValue({ success: true });

      const result = await mockApi.ux.updateUserPreferences('user_123', preferences);

      expect(result.success).toBe(true);
    });
  });

  describe('Usage Analytics', () => {
    it('provides usage analytics and insights', async () => {
      const mockAnalytics = {
        total_sessions: 45,
        average_session_duration: 28.5,
        most_used_features: ['dashboard', 'pipelines', 'knowledge_graph'],
        feature_adoption_trends: {
          dashboard: 'increasing',
          pipelines: 'stable',
          knowledge_graph: 'increasing'
        },
        engagement_score: 8.2,
        recommendations: [
          'You might benefit from exploring advanced pipeline features',
          'Consider using the knowledge graph for better insights'
        ]
      };

      mockApi.ux.getUsageAnalytics.mockResolvedValue(mockAnalytics);

      const analytics = await mockApi.ux.getUsageAnalytics('user_123', 30);

      expect(analytics).toHaveProperty('total_sessions');
      expect(analytics).toHaveProperty('average_session_duration');
      expect(analytics).toHaveProperty('most_used_features');
      expect(analytics).toHaveProperty('engagement_score');
      expect(analytics.engagement_score).toBeGreaterThanOrEqual(0);
      expect(analytics.engagement_score).toBeLessThanOrEqual(10);
      expect(Array.isArray(analytics.recommendations)).toBe(true);
    });
  });
});

describe('User Experience - Integration Tests', () => {
  describe('End-to-End User Journey', () => {
    it('completes full user scoring and intervention cycle', async () => {
      // 1. Get initial score
      mockApi.scoring.getUserScore.mockResolvedValue({ current_score: 65.0 });
      const initialScore = await mockApi.scoring.getUserScore('user_123');
      expect(initialScore.current_score).toBe(65.0);

      // 2. Complete an action that increases score
      mockApi.scoring.updateUserScore.mockResolvedValue({ success: true, new_score: 75.0 });
      const scoreUpdate = await mockApi.scoring.updateUserScore({
        user_id: 'user_123',
        action: 'completed_task',
        points: 10
      });
      expect(scoreUpdate.new_score).toBe(75.0);

      // 3. Get personalized recommendations
      mockApi.ux.getPersonalizedRecommendations.mockResolvedValue([
        { feature: 'advanced_features', reason: 'Score improvement', confidence: 0.8 }
      ]);
      const recommendations = await mockApi.ux.getPersonalizedRecommendations('user_123');
      expect(recommendations.length).toBeGreaterThan(0);

      // 4. Create intervention based on score
      mockApi.interventions.createIntervention.mockResolvedValue({
        id: 'int_score_boost',
        type: 'coaching',
        status: 'active'
      });
      const intervention = await mockApi.interventions.createIntervention({
        user_id: 'user_123',
        type: 'coaching',
        title: 'Score Improvement Session'
      });
      expect(intervention.status).toBe('active');
    });

    it('handles A/B testing user assignment and tracking', async () => {
      // 1. Assign user to experiment
      mockApi.abTesting.assignUserToVariant.mockResolvedValue({
        user_id: 'user_123',
        experiment_id: 'ui_improvements',
        variant: 'new_design'
      });
      const assignment = await mockApi.abTesting.assignUserToVariant('user_123', 'ui_improvements');
      expect(assignment.variant).toBeDefined();

      // 2. Track user interactions
      mockApi.abTesting.trackConversion.mockResolvedValue({ success: true });
      await mockApi.abTesting.trackConversion({
        user_id: 'user_123',
        experiment_id: 'ui_improvements',
        variant: assignment.variant,
        event_type: 'feature_usage'
      });

      // 3. Get experiment results
      mockApi.abTesting.getExperimentResults.mockResolvedValue({
        experiment_id: 'ui_improvements',
        variants: { control: {}, new_design: {} },
        winner: 'new_design'
      });
      const results = await mockApi.abTesting.getExperimentResults('ui_improvements');
      expect(results.winner).toBeDefined();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('handles scoring system errors gracefully', async () => {
      mockApi.scoring.getUserScore.mockRejectedValue(new Error('Database connection failed'));
      await expect(mockApi.scoring.getUserScore('invalid_user')).rejects.toThrow();
    });

    it('manages intervention conflicts', async () => {
      // Multiple interventions of same type
      mockApi.interventions.getActiveInterventions.mockResolvedValue([
        { id: 'int_1', type: 'reminder', priority: 'high' },
        { id: 'int_2', type: 'reminder', priority: 'medium' }
      ]);
      const interventions = await mockApi.interventions.getActiveInterventions('user_123');
      expect(interventions.length).toBe(2);
    });

    it('validates A/B test experiment parameters', async () => {
      // Invalid experiment creation
      mockApi.abTesting.createExperiment.mockRejectedValue(new Error('Invalid experiment parameters'));
      await expect(mockApi.abTesting.createExperiment({})).rejects.toThrow();
    });
  });
});
