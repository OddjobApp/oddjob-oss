import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Building2,
  Users,
  Activity,
  Trash2,
  Plus,
  Search,
  ArrowUpRight,
  Zap,
  MoreVertical,
  Calendar,
  ShieldCheck,
  CreditCard,
  LayoutGrid,
  Table as TableIcon,
  RefreshCw,
  Clock,
  Settings,
  SlidersHorizontal,
  X,
  AlertTriangle
} from 'lucide-react';
import { Card, CardHeader, CardContent, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@domain-ui/core/ui/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@domain-ui/core/ui/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@domain-ui/core/ui/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@domain-ui/core/ui/components/ui/select';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

export type Organization = {
  id: number;
  name: string;
  suppressionPolicyId: number | null;
  timezone?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  createdAt: string;
  userCount: number;
  jobCount: number;
};

const organizationsQueryKey = ['/api/admin/organizations'] as const;

const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'America/New_York (Eastern)' },
  { value: 'America/Chicago', label: 'America/Chicago (Central)' },
  { value: 'America/Denver', label: 'America/Denver (Mountain)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
];

export default function OrganizationsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Filter and view states
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'users' | 'jobs' | 'newest'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    timezone: 'UTC',
    suppressionPolicyId: '',
  });

  const [orgToDelete, setOrgToDelete] = useState<Organization | null>(null);

  // Queries
  const { data: orgsData, isLoading, isFetching, refetch } = useQuery<{ organizations: Organization[] }>({
    queryKey: organizationsQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/organizations');
      return res.json();
    },
  });

  const organizations = useMemo(() => orgsData?.organizations ?? [], [orgsData]);

  // Mutations
  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const payload: { name: string; suppressionPolicyId?: number; timezone?: string } = {
        name: createForm.name.trim(),
      };
      if (createForm.suppressionPolicyId) {
        payload.suppressionPolicyId = Number(createForm.suppressionPolicyId);
      }
      if (createForm.timezone) {
        payload.timezone = createForm.timezone;
      }

      const res = await apiRequest('POST', '/api/admin/organizations', payload);
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to create organization';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorText;
        } catch {
          errorMessage = errorText || `HTTP ${res.status}: ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      setIsCreateOpen(false);
      setCreateForm({ name: '', timezone: 'UTC', suppressionPolicyId: '' });
      toast({
        title: 'Organization created',
        description: 'The organization has been successfully created.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create organization',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (orgId: number) => {
      await apiRequest('DELETE', `/api/admin/organizations/${orgId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      setOrgToDelete(null);
      toast({
        title: 'Organization deleted',
        description: 'The organization was removed successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Deletion failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Filtered and sorted list
  const filteredOrgs = useMemo(() => {
    return organizations
      .filter((org) => {
        const matchesSearch =
          org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          org.id.toString().includes(searchQuery);

        const matchesPlan =
          planFilter === 'all' ||
          (planFilter === 'enterprise' && org.subscriptionPlan?.toLowerCase().includes('enterprise')) ||
          (planFilter === 'pro' && org.subscriptionPlan?.toLowerCase().includes('pro')) ||
          (planFilter === 'standard' && (!org.subscriptionPlan || org.subscriptionPlan.toLowerCase().includes('free') || org.subscriptionPlan.toLowerCase().includes('standard')));

        return matchesSearch && matchesPlan;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'users') return (b.userCount || 0) - (a.userCount || 0);
        if (sortBy === 'jobs') return (b.jobCount || 0) - (a.jobCount || 0);
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [organizations, searchQuery, planFilter, sortBy]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const totalOrgs = organizations.length;
    const totalUsers = organizations.reduce((acc, curr) => acc + (curr.userCount || 0), 0);
    const totalJobs = organizations.reduce((acc, curr) => acc + (curr.jobCount || 0), 0);
    const enterpriseCount = organizations.filter(
      (o) => o.subscriptionPlan?.toLowerCase().includes('enterprise') || o.subscriptionPlan?.toLowerCase().includes('pro')
    ).length;

    return {
      totalOrgs,
      totalUsers,
      totalJobs,
      enterpriseCount,
    };
  }, [organizations]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      toast({
        title: 'Validation error',
        description: 'Organization name is required.',
        variant: 'destructive',
      });
      return;
    }
    createOrgMutation.mutate();
  };

  const getPlanBadge = (plan?: string | null, _status?: string | null) => {
    const cleanPlan = (plan || 'Standard').toUpperCase();

    if (cleanPlan.includes('ENTERPRISE')) {
      return (
        <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 font-semibold text-[10px]">
          <ShieldCheck className="w-3 h-3 mr-1" />
          Enterprise
        </Badge>
      );
    }
    if (cleanPlan.includes('PRO')) {
      return (
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px]">
          <Zap className="w-3 h-3 mr-1" />
          Pro Tier
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="font-medium text-[10px]">
        Standard
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground px-4 pb-16 pt-4 md:px-8">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-6">
        {/* Header Section */}
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                Account & Admin // Organizations
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Organizations
              </h1>
              <p className="mt-1 max-w-2xl text-sm font-medium text-muted-foreground">
                Manage tenant accounts, user assignments, execution workloads, and organization settings.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-10 rounded-xl border-foreground/10 bg-foreground/[0.02] px-4 text-xs font-semibold hover:bg-foreground/[0.06]"
            >
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/account-admin/users")}
              className="h-10 rounded-xl border-foreground/10 bg-foreground/[0.02] px-4 text-xs font-semibold text-foreground hover:bg-foreground/[0.06]"
            >
              <Users className="mr-2 h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Manage Users
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="h-10 rounded-xl bg-primary text-primary-foreground px-5 text-xs font-bold shadow-md hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Organization
            </Button>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-foreground/10 bg-foreground/[0.03] shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Total Organizations</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                ) : (
                  <p className="mt-1 text-3xl font-black text-foreground">{metrics.totalOrgs}</p>
                )}
                <p className="mt-1 text-xs font-medium text-muted-foreground">Active tenant records</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                <Building2 className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-foreground/10 bg-foreground/[0.03] shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Total Members</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                ) : (
                  <p className="mt-1 text-3xl font-black text-blue-600 dark:text-blue-400">{metrics.totalUsers}</p>
                )}
                <p className="mt-1 text-xs font-medium text-muted-foreground">Assigned across organizations</p>
              </div>
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-blue-600 dark:text-blue-400">
                <Users className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-foreground/10 bg-foreground/[0.03] shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Active Workloads</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                ) : (
                  <p className="mt-1 text-3xl font-black text-amber-600 dark:text-amber-400">{metrics.totalJobs}</p>
                )}
                <p className="mt-1 text-xs font-medium text-muted-foreground">Jobs & agent executions</p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
                <Activity className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-foreground/10 bg-foreground/[0.03] shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Tier Coverage</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                ) : (
                  <p className="mt-1 text-3xl font-black text-purple-600 dark:text-purple-400">
                    {metrics.enterpriseCount} <span className="text-sm font-semibold text-muted-foreground">/ {metrics.totalOrgs}</span>
                  </p>
                )}
                <p className="mt-1 text-xs font-medium text-muted-foreground">Pro or Enterprise tiers</p>
              </div>
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-3 text-purple-600 dark:text-purple-400">
                <CreditCard className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter and Control Bar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 rounded-xl pl-9 pr-8 text-sm bg-background border-foreground/10"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="h-10 w-[150px] rounded-xl border-foreground/10 bg-background text-xs">
                <SelectValue placeholder="All Tiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="pro">Pro Tier</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl border-foreground/10 bg-background text-xs">
                <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="name">Name (A - Z)</SelectItem>
                <SelectItem value="users">Most Members</SelectItem>
                <SelectItem value="jobs">Most Workloads</SelectItem>
              </SelectContent>
            </Select>

            {(searchQuery || planFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setPlanFilter('all');
                }}
                className="h-10 text-xs text-muted-foreground hover:text-foreground"
              >
                Reset Filters
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 self-end lg:self-auto">
            <span className="text-xs font-semibold text-muted-foreground mr-2">
              Showing {filteredOrgs.length} of {organizations.length}
            </span>
            <div className="flex items-center rounded-xl border border-foreground/10 bg-background p-1">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className={cn('h-8 px-2.5 rounded-lg text-xs', viewMode === 'grid' && 'bg-foreground/10')}
                title="Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('table')}
                className={cn('h-8 px-2.5 rounded-lg text-xs', viewMode === 'table' && 'bg-foreground/10')}
                title="Table View"
              >
                <TableIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content Section */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border-foreground/10 bg-foreground/[0.02]">
                <CardHeader className="p-6">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-2xl bg-foreground/10" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-3/4 bg-foreground/10" />
                      <Skeleton className="h-3 w-1/2 bg-foreground/10" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-0 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-16 rounded-xl bg-foreground/10" />
                    <Skeleton className="h-16 rounded-xl bg-foreground/10" />
                  </div>
                </CardContent>
                <CardFooter className="p-6 pt-0">
                  <Skeleton className="h-10 w-full rounded-xl bg-foreground/10" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-foreground/15 bg-foreground/[0.01] p-12 text-center my-6">
            <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-4 text-muted-foreground mb-4">
              <Building2 className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-foreground">No organizations found</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {searchQuery || planFilter !== 'all'
                ? 'Try adjusting your search query or tier filters to find what you are looking for.'
                : 'Get started by creating your first tenant organization in the platform.'}
            </p>
            <div className="mt-6 flex gap-3">
              {searchQuery || planFilter !== 'all' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery('');
                    setPlanFilter('all');
                  }}
                  className="rounded-xl"
                >
                  Clear Filters
                </Button>
              ) : (
                <Button onClick={() => setIsCreateOpen(true)} className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Organization
                </Button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredOrgs.map((org) => (
              <Card
                key={org.id}
                className="border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.035] transition-all hover:border-primary/40 hover:shadow-md group flex flex-col justify-between rounded-2xl overflow-hidden"
              >
                <div>
                  <CardHeader className="p-6 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-foreground/10 bg-background text-primary group-hover:scale-105 group-hover:border-primary/40 transition-all shadow-sm">
                          <Building2 className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/account-admin/organizations/${org.id}`}
                              className="font-bold text-lg text-foreground hover:text-primary transition-colors truncate block"
                            >
                              {org.name}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] font-mono font-medium text-muted-foreground">
                              ID: #{org.id}
                            </span>
                            <span className="text-foreground/20">•</span>
                            {getPlanBadge(org.subscriptionPlan, org.subscriptionStatus)}
                          </div>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setLocation(`/account-admin/organizations/${org.id}`)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Manage Organization
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLocation(`/account-admin/users?orgId=${org.id}`)}>
                            <Users className="mr-2 h-4 w-4" />
                            Manage Members
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLocation(`/account-admin/billing`)}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            Billing & Plans
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setOrgToDelete(org)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Organization
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6 pt-2 space-y-4">
                    {/* Metrics Sub-grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-foreground/10 bg-background/60 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5 text-blue-500" />
                          <span>Members</span>
                        </div>
                        <p className="mt-1 text-xl font-bold text-foreground font-mono">
                          {org.userCount || 0}
                        </p>
                      </div>

                      <div className="rounded-xl border border-foreground/10 bg-background/60 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Activity className="h-3.5 w-3.5 text-amber-500" />
                          <span>Active Jobs</span>
                        </div>
                        <p className="mt-1 text-xl font-bold text-foreground font-mono">
                          {org.jobCount || 0}
                        </p>
                      </div>
                    </div>

                    {/* Metadata tags */}
                    <div className="space-y-2 pt-1 border-t border-foreground/5 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-foreground/40" />
                          Timezone
                        </span>
                        <span className="font-mono text-foreground font-medium text-[11px]">
                          {org.timezone || 'UTC (Default)'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-foreground/40" />
                          Created
                        </span>
                        <span className="text-foreground/80 font-medium">
                          {new Date(org.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </div>

                <CardFooter className="p-6 pt-0 border-t border-foreground/5 bg-foreground/[0.01]">
                  <div className="flex w-full items-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => setLocation(`/account-admin/organizations/${org.id}`)}
                      className="w-full h-10 rounded-xl font-semibold text-xs border-foreground/10 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all group/btn"
                    >
                      <span>Manage Settings</span>
                      <ArrowUpRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          /* Table View */
          <Card className="border-foreground/10 bg-foreground/[0.02] rounded-2xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="border-foreground/10 bg-foreground/[0.03] hover:bg-foreground/[0.03]">
                  <TableHead className="font-bold text-xs uppercase tracking-wider">Organization</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider">Tier / Plan</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-center">Members</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-center">Workloads</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider">Timezone</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider">Created</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrgs.map((org) => (
                  <TableRow key={org.id} className="border-foreground/5 hover:bg-foreground/[0.03] transition-colors">
                    <TableCell className="font-medium py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-foreground/10 bg-background text-primary">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <Link
                            href={`/account-admin/organizations/${org.id}`}
                            className="font-bold text-foreground hover:text-primary transition-colors"
                          >
                            {org.name}
                          </Link>
                          <p className="text-[11px] font-mono text-muted-foreground">ID: #{org.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getPlanBadge(org.subscriptionPlan, org.subscriptionStatus)}</TableCell>
                    <TableCell className="text-center font-mono font-bold">{org.userCount || 0}</TableCell>
                    <TableCell className="text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                      {org.jobCount || 0}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {org.timezone || 'UTC'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(org.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLocation(`/account-admin/organizations/${org.id}`)}
                          className="h-8 rounded-lg text-xs font-semibold hover:bg-primary hover:text-primary-foreground"
                        >
                          Manage
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => setLocation(`/account-admin/organizations/${org.id}`)}>
                              <Settings className="mr-2 h-4 w-4" />
                              View Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLocation(`/account-admin/users?orgId=${org.id}`)}>
                              <Users className="mr-2 h-4 w-4" />
                              Manage Users
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLocation(`/account-admin/billing`)}>
                              <CreditCard className="mr-2 h-4 w-4" />
                              Billing
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setOrgToDelete(org)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Create Organization Dialog */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold">Create Organization</DialogTitle>
                  <DialogDescription className="text-xs">
                    Register a new tenant organization to partition users, roles, and workloads.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="org-name" className="text-xs font-bold">
                  Organization Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="org-name"
                  placeholder="e.g. Acme Corporation"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="rounded-xl border-foreground/10"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="org-timezone" className="text-xs font-bold">
                  Primary Timezone
                </Label>
                <Select
                  value={createForm.timezone}
                  onValueChange={(val) => setCreateForm((prev) => ({ ...prev, timezone: val }))}
                >
                  <SelectTrigger id="org-timezone" className="rounded-xl border-foreground/10 text-xs">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value} className="text-xs">
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Used for locale-aware scheduling and geospatial baseline views.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="org-policy" className="text-xs font-bold">
                  Suppression Policy ID <span className="text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <Input
                  id="org-policy"
                  type="number"
                  placeholder="e.g. 101"
                  value={createForm.suppressionPolicyId}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, suppressionPolicyId: e.target.value }))}
                  className="rounded-xl border-foreground/10"
                />
              </div>

              <DialogFooter className="pt-3 gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createOrgMutation.isPending || !createForm.name.trim()}
                  className="rounded-xl bg-primary text-primary-foreground font-bold"
                >
                  {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!orgToDelete} onOpenChange={(open) => !open && setOrgToDelete(null)}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <div className="flex items-center gap-3 text-destructive">
                <div className="p-2 rounded-xl bg-destructive/10">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <DialogTitle className="text-xl font-bold">Delete Organization?</DialogTitle>
              </div>
              <DialogDescription className="text-xs pt-2">
                Are you sure you want to delete <strong className="text-foreground">{orgToDelete?.name}</strong>?
                This action is permanent and will disassociate member assignments and scoped resources.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
              <p className="font-semibold">Warning:</p>
              <p>This cannot be undone. All active jobs and schedules for this organization may be terminated.</p>
            </div>

            <DialogFooter className="pt-2 gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrgToDelete(null)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteOrgMutation.isPending}
                onClick={() => orgToDelete && deleteOrgMutation.mutate(orgToDelete.id)}
                className="rounded-xl font-bold"
              >
                {deleteOrgMutation.isPending ? 'Deleting...' : 'Delete Organization'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
