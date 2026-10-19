import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Link } from 'wouter';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  linkTo?: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

export default function StatCard({ title, value, description, icon: Icon, linkTo, trend }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {linkTo ? (
          <Link 
            href={linkTo} 
            className="text-2xl font-bold text-foreground hover:text-primary cursor-pointer transition-colors block" 
            data-testid={`link-stat-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {value}
          </Link>
        ) : (
          <div className="text-2xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>{value}</div>
        )}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        {trend && (
          <p className={`text-xs mt-1 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '+' : ''}{trend.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
