import { Opportunity, OpportunityWindow, fmtCurrency } from "@/lib/platform-client";
import { StageBadge } from "./StageBadge";
import { DecayBar } from "./DecayBar";

interface DealCardProps {
  opportunity: Opportunity;
  window?: OpportunityWindow;
  onClick?: () => void;
  isDragging?: boolean;
}

export function DealCard({ opportunity, window, onClick, isDragging }: DealCardProps) {
  return (
    <div
      onClick={onClick}
      className={`p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-slate-600 transition-all cursor-pointer ${
        isDragging ? "opacity-50 rotate-2" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm truncate">{opportunity.name}</h3>
          <p className="text-xs text-slate-400 mt-1">{opportunity.account_id}</p>
        </div>
        <div className="ml-3">
          <StageBadge stage={opportunity.stage} probability={window?.current_ceiling} size="sm" />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-bold text-white">
          {fmtCurrency(opportunity.amount)}
        </div>
        {opportunity.expected_close && (
          <div className="text-xs text-slate-500">
            Close: {new Date(opportunity.expected_close).toLocaleDateString()}
          </div>
        )}
      </div>

      {window && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <DecayBar window={window} size="sm" />
        </div>
      )}

      {opportunity.owner_rep && (
        <div className="mt-2 text-xs text-slate-500">
          Owner: {opportunity.owner_rep}
        </div>
      )}
    </div>
  );
}
