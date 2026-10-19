import { Activity } from "@/lib/platform-client";

interface EngagementTimelineProps {
  activities: Activity[];
  compact?: boolean;
}

export function EngagementTimeline({ activities, compact = false }: EngagementTimelineProps) {
  if (!activities || activities.length === 0) {
    return (
      <div className="text-center text-sm text-slate-500 py-4">
        No engagement history
      </div>
    );
  }

  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  );

  return (
    <div className="space-y-3">
      {sortedActivities.map((activity, index) => (
        <div key={activity.activity_id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-2 h-2 rounded-full ${
              activity.is_rearm_signal ? 'bg-emerald-500' : 'bg-slate-500'
            }`} />
            {index < sortedActivities.length - 1 && (
              <div className="w-0.5 flex-1 bg-slate-800 mt-1" />
            )}
          </div>
          <div className={`flex-1 ${compact ? 'pb-2' : 'pb-4'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-300">{activity.type}</span>
              <span className="text-xs text-slate-500">
                {new Date(activity.occurred_at).toLocaleDateString()}
              </span>
              {activity.is_rearm_signal && (
                <span className="text-xs text-emerald-400">Rearm</span>
              )}
            </div>
            {activity.summary && (
              <p className="text-sm text-slate-400">{activity.summary}</p>
            )}
            {activity.actor && (
              <p className="text-xs text-slate-500 mt-1">by {activity.actor}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
