import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

export function CostSummaryWidget() {
    // This would fetch real data from API
    const costs = {
        today: 12.45,
        yesterday: 10.23,
        thisMonth: 342.67,
        lastMonth: 298.12,
    };

    const dailyChange = ((costs.today - costs.yesterday) / costs.yesterday) * 100;
    const monthlyChange = ((costs.thisMonth - costs.lastMonth) / costs.lastMonth) * 100;

    return (
        <div className="widget-content">
            <div className="cost-summary">
                <div className="cost-main">
                    <DollarSign className="w-8 h-8 text-green-500" />
                    <div className="cost-amount">${costs.today.toFixed(2)}</div>
                    <div className="cost-label">Today</div>
                    <div className={`cost-change ${dailyChange >= 0 ? 'positive' : 'negative'}`}>
                        {dailyChange >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {Math.abs(dailyChange).toFixed(1)}% vs yesterday
                    </div>
                </div>

                <div className="cost-breakdown">
                    <div className="cost-item">
                        <span className="cost-item-label">This Month</span>
                        <span className="cost-item-value">${costs.thisMonth.toFixed(2)}</span>
                    </div>
                    <div className="cost-item">
                        <span className="cost-item-label">Last Month</span>
                        <span className="cost-item-value">${costs.lastMonth.toFixed(2)}</span>
                    </div>
                    <div className={`cost-item ${monthlyChange >= 0 ? 'positive' : 'negative'}`}>
                        <span className="cost-item-label">Monthly Change</span>
                        <span className="cost-item-value">
                            {monthlyChange >= 0 ? '+' : ''}{monthlyChange.toFixed(1)}%
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
