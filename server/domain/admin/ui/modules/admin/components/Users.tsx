import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Users as UsersIcon, Shield, User as UserIcon, MoreVertical, Pencil, Trash2, Crown, Building2, Mail } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { User } from "@shared/schema/auth";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";

interface Org {
  id: number;
  name: string;
}

interface AdminRole {
  id: number;
  userId: string;
  roleType: 'super_admin' | 'org_admin';
  organizationId: number | null;
  username?: string;
  orgName?: string;
}

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'user' | 'super_admin' | 'org_admin';
  isActive: boolean;
  organizationId?: number | null;
  organizationName?: string;
  phoneNumber?: string;
  notificationPreference?: string;
  quietModeEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  permissions?: string[];
  alertFilters?: {
    severity: string;
  };
  createdDate?: string;
  lastLogin?: string;
}

export default function Users() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'operator' as 'operator' | 'approver' | 'auditor' | 'administrator',
  });
  const [newUser, setNewUser] = useState<{
    email: string;
    firstName: string;
    lastName: string;
    username: string;
    password: string;
    organizationId: number | null;
  }>({
    email: '',
    firstName: '',
    lastName: '',
    username: '',
    password: '',
    organizationId: null,
  });

  // Fetch organizations (for super admin filter and user creation)
  const { data: organizationsData } = useQuery<{ organizations?: Org[] } | Org[]>({
    queryKey: ['/api/admin/organizations'],
    queryFn: async () => {
      const res = await fetch("/api/admin/organizations", {
        credentials: "include",
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      return data;
    },
    enabled: !!currentUser, // Only fetch if user is logged in
  });

  // Ensure organizations is always an array
  const organizations: Org[] = Array.isArray(organizationsData)
    ? organizationsData
    : (organizationsData?.organizations || []);

  // Fetch admin roles
  const { data: adminRoles = [] } = useQuery<AdminRole[]>({
    queryKey: ['/api/admin/roles'],
    queryFn: async () => {
      const res = await fetch("/api/admin/roles", {
        credentials: "include",
      });
      if (!res.ok) {
        return [];
      }
      return res.json();
    },
    enabled: !!currentUser, // Only fetch if user is logged in
  });

  // Fetch users from API (with optional orgId filter for super admin)
  const { data: usersData = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users', selectedOrgId],
    queryFn: async () => {
      const url = selectedOrgId && selectedOrgId !== 'all'
        ? `/api/admin/users?orgId=${selectedOrgId}`
        : '/api/admin/users';
      const res = await fetch(url, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch users");
      }
      return res.json();
    },
  });

  // Map API users to UserData format with admin roles and organizations
  const users: UserData[] = usersData.map((user) => {
    const adminRole = adminRoles.find(ar => ar.userId === user.id);
    const org = organizations.find(o => o.id === user.defaultOrgId);

    let role: 'admin' | 'user' | 'super_admin' | 'org_admin' = 'user';
    if (adminRole?.roleType === 'super_admin') {
      role = 'super_admin';
    } else if (adminRole?.roleType === 'org_admin') {
      role = 'org_admin';
    } else if (user.username === 'admin') {
      role = 'admin'; // Legacy admin check
    }

    return {
      id: user.id,
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      role,
      isActive: true,
      organizationId: user.defaultOrgId || null,
      organizationName: org?.name || adminRole?.orgName || undefined,
      quietModeEnabled: user.quietHoursEnabled || false,
      quietHoursStart: user.quietHoursStart || undefined,
      quietHoursEnd: user.quietHoursEnd || undefined,
      createdDate: undefined,
    };
  });

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    `${user.firstName} ${user.lastName}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const createUserMutation = useMutation({
    mutationFn: async (userData: {
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      username: string;
      organizationId: number;
    }) => {
      const response = await apiRequest('POST', '/api/admin/users', userData);
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorText;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      toast({
        title: 'User created',
        description: 'The user has been created successfully.',
      });
      setIsCreateDialogOpen(false);
      setNewUser({
        email: '',
        firstName: '',
        lastName: '',
        username: '',
        password: '',
        organizationId: null,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create user',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const inviteUserMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      const response = await apiRequest('POST', '/api/admin/invites', data);
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorText;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invites'] });
      toast({
        title: 'Invitation sent',
        description: data.invite?.email
          ? `An invite email was sent to ${data.invite.email}.`
          : 'Invitation created successfully.',
      });
      setIsInviteDialogOpen(false);
      setInviteForm({ email: '', role: 'operator' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to send invitation', description: error.message, variant: 'destructive' });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest('DELETE', `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: 'User deleted',
        description: 'The user has been removed successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to delete user',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleInviteUser = () => {
    if (!inviteForm.email) {
      toast({
        title: 'Validation error',
        description: 'Please provide an email address.',
        variant: 'destructive',
      });
      return;
    }
    inviteUserMutation.mutate({
      email: inviteForm.email,
      role: inviteForm.role,
    });
  };

  const handleCreateUser = () => {
    if (!newUser.email || !newUser.firstName || !newUser.lastName || !newUser.organizationId) {
      toast({
        title: 'Validation error',
        description: 'Please fill in all required fields including organization.',
        variant: 'destructive',
      });
      return;
    }
    // Use email prefix as username if username is not provided
    const username = newUser.username || newUser.email.split('@')[0];
    // Generate a temporary password - in production, this should be handled differently
    const password = newUser.password || 'TempPassword123!';

    // Ensure organizationId is a number
    const organizationId = typeof newUser.organizationId === 'string'
      ? parseInt(newUser.organizationId, 10)
      : newUser.organizationId;

    if (isNaN(organizationId)) {
      toast({
        title: 'Validation error',
        description: 'Invalid organization selected.',
        variant: 'destructive',
      });
      return;
    }

    createUserMutation.mutate({
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      username,
      password,
      organizationId,
    });
  };

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      return await apiRequest('PATCH', `/api/users/${userId}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: 'User status updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update status', description: error.message, variant: 'destructive' });
    },
  });

  const handleToggleActive = (userId: string) => {
    const user = users?.find((u: any) => u.id === userId);
    if (user) {
      toggleActiveMutation.mutate({ userId, isActive: !user.isActive });
    }
  };

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      deleteUserMutation.mutate(userId);
    }
  };

  const getRoleBadge = (role: string) => {
    if (role === 'super_admin') {
      return (
        <Badge variant="default" className="bg-yellow-100 text-yellow-800">
          <Crown className="w-3 h-3 mr-1" />
          Super Admin
        </Badge>
      );
    }
    if (role === 'org_admin') {
      return (
        <Badge variant="default" className="bg-purple-100 text-purple-800">
          <Shield className="w-3 h-3 mr-1" />
          Org Admin
        </Badge>
      );
    }
    if (role === 'admin') {
      return (
        <Badge variant="default" className="bg-purple-100 text-purple-800">
          <Shield className="w-3 h-3 mr-1" />
          Admin
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <UserIcon className="w-3 h-3 mr-1" />
        User
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system users and permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsInviteDialogOpen(true)} data-testid="button-invite-user">
            <Mail className="w-4 h-4 mr-2" />
            Invite User
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-user">
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <UsersIcon className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {users.filter(u => u.isActive).length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Administrators</CardTitle>
            <Shield className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.filter(u => u.role === 'admin').length}</div>
            <p className="text-xs text-muted-foreground mt-1">Full system access</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Regular Users</CardTitle>
            <UserIcon className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.filter(u => u.role === 'user').length}</div>
            <p className="text-xs text-muted-foreground mt-1">Limited permissions</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>Manage user accounts and access levels</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {currentUser?.username === 'admin' && (
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filter by organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id.toString()}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
                data-testid="input-search-users"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">
                        <Link href={`/account-admin/users/${user.id}`} className="text-primary hover:underline cursor-pointer" data-testid={`link-user-${user.id}`}>
                          {user.firstName} {user.lastName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        {user.organizationName ? (
                          <div className="flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-muted-foreground" />
                            <span className="text-sm">{user.organizationName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No organization</span>
                        )}
                      </TableCell>
                      <TableCell>{getRoleBadge(user.role)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.isActive}
                            onCheckedChange={() => handleToggleActive(user.id)}
                            data-testid={`switch-active-${user.id}`}
                          />
                          <span className="text-sm text-muted-foreground">
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-actions-${user.id}`}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setLocation(`/account-admin/users/${user.id}`)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDeleteUser(user.id)} className="text-destructive">
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredUsers.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No users found matching your search.</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account for the system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="user-firstname">First Name</Label>
                <Input
                  id="user-firstname"
                  placeholder="John"
                  value={newUser.firstName}
                  onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                  data-testid="input-user-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-lastname">Last Name</Label>
                <Input
                  id="user-lastname"
                  placeholder="Doe"
                  value={newUser.lastName}
                  onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                  data-testid="input-user-lastname"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="john.doe@oddjob.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                data-testid="input-user-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                placeholder="johndoe"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                data-testid="input-user-username"
              />
              <p className="text-xs text-muted-foreground">Leave empty to use email prefix</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                placeholder="TempPassword123!"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                data-testid="input-user-password"
              />
              <p className="text-xs text-muted-foreground">Leave empty for default temporary password</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-organization">Organization *</Label>
              <Select
                value={newUser.organizationId?.toString() || ''}
                onValueChange={(value) => setNewUser({ ...newUser, organizationId: parseInt(value) })}
              >
                <SelectTrigger id="user-organization" data-testid="select-user-organization">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id.toString()}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} data-testid="button-cancel-user">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateUser}
              disabled={createUserMutation.isPending}
              data-testid="button-submit-user"
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>Send an email invitation to join an organization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) =>
                  setInviteForm({ ...inviteForm, role: value as typeof inviteForm.role })
                }
              >
                <SelectTrigger id="invite-role" data-testid="select-invite-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="auditor">Auditor</SelectItem>
                  <SelectItem value="administrator">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)} data-testid="button-cancel-invite">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleInviteUser}
              disabled={inviteUserMutation.isPending}
              data-testid="button-submit-invite"
            >
              {inviteUserMutation.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

