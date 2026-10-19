import { useState, useEffect, useMemo } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Shield, User as UserIcon, Pencil, Trash2, X, Save, Bell, BellOff, Clock, Filter, Lock, Eye, EyeOff, Crown, Building2 } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { User } from "@shared/schema/auth";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'user' | 'super_admin' | 'org_admin';
  isActive: boolean;
  phoneNumber?: string;
  notificationPreference: string;
  quietModeEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  permissions: string[];
  alertFilters: {
    severity: string;
  };
  lastLogin?: string;
  createdDate: string;
}

// User data is now fetched from API - no mock data needed

// Available permissions grouped by category
const AVAILABLE_PERMISSIONS = {
  'User Management': [
    { id: 'user:view_all', label: 'View all users' },
    { id: 'user:manage_users', label: 'Create/edit users' },
    { id: 'user:manage_roles', label: 'Manage user roles' },
    { id: 'user:manage_active', label: 'Activate/deactivate users' },
  ],
  'Settings': [
    { id: 'settings:view', label: 'View settings' },
    { id: 'settings:manage', label: 'Manage settings' },
  ],
  'Jobs': [
    { id: 'job:create_edit', label: 'Create/edit jobs' },
    { id: 'job:test_sync', label: 'Test/sync jobs' },
    { id: 'job:manage_credentials', label: 'Manage job credentials' },
  ],
  'Executions': [
    { id: 'exec:view_all', label: 'View all executions' },
    { id: 'exec:view_own', label: 'View own executions' },
  ],
  'Alerts': [
    { id: 'alert:view_all', label: 'View all alerts' },
    { id: 'alert:acknowledge_all', label: 'Acknowledge all alerts' },
  ],
};

interface AdminRole {
  id: number;
  userId: string;
  roleType: 'super_admin' | 'org_admin';
  organizationId: number | null;
  username?: string;
  orgName?: string;
}

interface Org {
  id: number;
  name: string;
}

export default function UserDetail() {
  const [, accountParams] = useRoute('/account-admin/users/:id');
  const [, legacyParams] = useRoute('/users/:id');
  const params = accountParams || legacyParams;
  const [, setLocation] = useLocation();
  const userId = params?.id || '';
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isAssigningRole, setIsAssigningRole] = useState(false);
  const [roleAssignment, setRoleAssignment] = useState<{
    roleType: 'super_admin' | 'org_admin' | '';
    organizationId: number | null;
  }>({ roleType: '', organizationId: null });

  // Fetch user from API
  const { data: userData, isLoading } = useQuery<User>({
    queryKey: ['/api/users', userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch user");
      }
      return res.json();
    },
    enabled: !!userId,
  });

  // Fetch admin role for this user
  const { data: adminRole } = useQuery<AdminRole>({
    queryKey: ['/api/admin/roles/user', userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/roles/user/${userId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        return null;
      }
      return res.json();
    },
    enabled: !!userId && currentUser?.username === 'admin',
  });

  // Fetch organizations (for role assignment)
  const { data: organizationsData } = useQuery<{ organizations: Org[] }>({
    queryKey: ['/api/admin/organizations'],
    queryFn: async () => {
      const res = await fetch("/api/admin/organizations", {
        credentials: "include",
      });
      if (!res.ok) {
        return { organizations: [] };
      }
      return res.json();
    },
    enabled: !!currentUser && currentUser.username === 'admin',
  });

  const organizations = organizationsData?.organizations || [];

  // Map API user to UserData format.
  //
  // Memoized on the two queries it derives from, and that is load-bearing: the
  // effect below depends on `user`, and an object literal rebuilt every render
  // is a new reference every render, so the effect would fire, setEditedUser,
  // re-render, rebuild the object, and fire again — forever.
  //
  // This never surfaced before because the page's fetch pointed at
  // /api/users/:id, which has no handler; `userData` stayed undefined, `user`
  // stayed null, and `null === null` kept the dependency stable. Repointing the
  // query at /api/admin/users/:id makes the data arrive, which is exactly what
  // arms the loop. A latent bug, uncovered by fixing the thing that hid it.
  const user: UserData | null = useMemo(() => (userData ? {
    id: userData.id,
    email: userData.email || '',
    firstName: userData.firstName || '',
    lastName: userData.lastName || '',
    role: adminRole?.roleType === 'super_admin' ? 'super_admin' as const
      : adminRole?.roleType === 'org_admin' ? 'org_admin' as const
        : (userData.username === 'admin' || userData.username === 'administrator') ? 'admin' as const
          : 'user' as const,
    isActive: true,
    quietModeEnabled: userData.quietHoursEnabled || false,
    quietHoursStart: userData.quietHoursStart || '',
    quietHoursEnd: userData.quietHoursEnd || '',
    notificationPreference: 'email',
    permissions: [],
    alertFilters: {
      severity: (userData.alertFilters as any)?.severity || 'all',
    },
    createdDate: 'Unknown',
    phoneNumber: undefined,
  } : null), [userData, adminRole]);

  const [editedUser, setEditedUser] = useState<UserData | null>(user);

  // Update editedUser when userData changes
  useEffect(() => {
    if (user) {
      setEditedUser(user);
    }
  }, [user]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<User>) => {
      return await apiRequest('PUT', `/api/admin/users/${userId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: 'User updated',
        description: 'The user has been updated successfully.',
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to update user',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Separate password reset state for admins
  const [passwordResetData, setPasswordResetData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Role assignment mutation (super admin only)
  const assignRoleMutation = useMutation({
    mutationFn: async (data: { userId: string; roleType: 'super_admin' | 'org_admin'; organizationId?: number | null }) => {
      return await apiRequest('POST', '/api/admin/roles', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles/user', userId] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId] });
      toast({
        title: 'Role assigned',
        description: 'Admin role has been assigned successfully.',
      });
      setIsAssigningRole(false);
      setRoleAssignment({ roleType: '', organizationId: null });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to assign role',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (roleId: number) => {
      return await apiRequest('DELETE', `/api/admin/roles/${roleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles/user', userId] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId] });
      toast({
        title: 'Role removed',
        description: 'Admin role has been removed successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to remove role',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleAssignRole = () => {
    if (!roleAssignment.roleType) {
      toast({
        title: 'Validation error',
        description: 'Please select a role type.',
        variant: 'destructive',
      });
      return;
    }
    if (roleAssignment.roleType === 'org_admin' && !roleAssignment.organizationId) {
      toast({
        title: 'Validation error',
        description: 'Please select an organization for org admin role.',
        variant: 'destructive',
      });
      return;
    }
    assignRoleMutation.mutate({
      userId,
      roleType: roleAssignment.roleType,
      organizationId: roleAssignment.roleType === 'super_admin' ? null : roleAssignment.organizationId,
    });
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

  const handleEdit = () => {
    setEditedUser(user);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedUser(user);
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!editedUser || !user) return;

    const updates: Partial<User> = {
      email: editedUser.email,
      firstName: editedUser.firstName,
      lastName: editedUser.lastName,
      quietHoursEnabled: editedUser.quietModeEnabled,
      quietHoursStart: editedUser.quietHoursStart || null,
      quietHoursEnd: editedUser.quietHoursEnd || null,
      alertFilters: editedUser.alertFilters as any,
    };

    updateMutation.mutate(updates);
  };

  const deleteUserMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('DELETE', `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: 'User deleted',
        description: 'User account has been deleted.',
      });
      setLocation('/account-admin/users');
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to delete user',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleDeleteUser = () => {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      deleteUserMutation.mutate();
    }
  };

  const togglePermission = (permissionId: string) => {
    if (!editedUser) return;
    const currentPermissions = editedUser.permissions || [];
    const newPermissions = currentPermissions.includes(permissionId)
      ? currentPermissions.filter(p => p !== permissionId)
      : [...currentPermissions, permissionId];
    setEditedUser({ ...editedUser, permissions: newPermissions });
  };

  const handlePasswordReset = () => {
    if (!user) return;

    // Validate password fields
    if (!passwordResetData.newPassword) {
      toast({
        title: 'New password required',
        description: 'Please enter a new password for this user.',
        variant: 'destructive',
      });
      return;
    }

    if (passwordResetData.newPassword.length < 8) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 8 characters long.',
        variant: 'destructive',
      });
      return;
    }

    if (passwordResetData.newPassword !== passwordResetData.confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'New password and confirm password must match.',
        variant: 'destructive',
      });
      return;
    }

    // There is no admin password-reset endpoint. /api/auth/reset-password is
    // the self-service flow and takes a signed token, not an admin override for
    // an arbitrary user id. This handler used to end with a success toast
    // reading "Password has been successfully reset for <name>" while calling
    // nothing at all — the admin was told the password changed when it had not.
    //
    // Reporting the gap is strictly better than reporting a false success.
    // Implementing the real thing is a security decision (who may do it, audit
    // logging, whether the user is notified, whether the session is revoked)
    // and belongs in the backend before this button does anything.
    toast({
      title: 'Password reset is not available',
      description:
        'No admin password-reset endpoint exists yet, so nothing was changed. ' +
        'Ask the user to use the self-service reset flow.',
      variant: 'destructive',
    });

    // Clear password fields and hide passwords
    setPasswordResetData({
      newPassword: '',
      confirmPassword: '',
    });
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading user...</p>
        </div>
      </div>
    );
  }

  if (!user || !editedUser) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/account-admin/users">
            <Button variant="ghost" size="icon" data-testid="button-back-to-users">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">User not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/account-admin/users">
          <Button variant="ghost" size="icon" data-testid="button-back-to-users">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          {isEditing ? (
            <div className="grid grid-cols-2 gap-4">
              <Input
                value={editedUser.firstName || ''}
                onChange={(e) => setEditedUser({ ...editedUser, firstName: e.target.value })}
                placeholder="First Name"
                data-testid="input-edit-firstname"
              />
              <Input
                value={editedUser.lastName || ''}
                onChange={(e) => setEditedUser({ ...editedUser, lastName: e.target.value })}
                placeholder="Last Name"
                data-testid="input-edit-lastname"
              />
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">
                {user.firstName} {user.lastName}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <>
              <Button onClick={handleEdit} data-testid="button-edit">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button variant="destructive" onClick={handleDeleteUser} data-testid="button-delete">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleCancel} data-testid="button-cancel">
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} data-testid="button-save">
                <Save className="w-4 h-4 mr-2" />
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Core account details and settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Email */}
                <div className="space-y-2">
                  <Label>Email</Label>
                  {isEditing ? (
                    <Input
                      type="email"
                      value={editedUser.email}
                      onChange={(e) => setEditedUser({ ...editedUser, email: e.target.value })}
                      data-testid="input-edit-email"
                    />
                  ) : (
                    <p className="text-sm text-foreground">{user.email}</p>
                  )}
                </div>

                {/* Role */}
                <div className="space-y-2">
                  <Label>Role</Label>
                  {isEditing ? (
                    <Select
                      value={editedUser.role}
                      onValueChange={(value: 'admin' | 'user') => setEditedUser({ ...editedUser, role: value })}
                    >
                      <SelectTrigger data-testid="select-edit-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrator</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2">
                      {getRoleBadge(user.role)}
                      {currentUser?.username === 'admin' && adminRole && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRoleMutation.mutate(adminRole.id)}
                          className="text-xs"
                        >
                          Remove Role
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Organization */}
                <div className="space-y-2">
                  <Label>Organization</Label>
                  {userData?.defaultOrgId ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-foreground">
                        {organizations.find(o => o.id === userData.defaultOrgId)?.name || `Organization ${userData.defaultOrgId}`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No organization assigned</p>
                  )}
                </div>

                {/* Admin Role Details (for super admin) */}
                {currentUser?.username === 'admin' && adminRole && (
                  <div className="space-y-2">
                    <Label>Admin Role Details</Label>
                    <div className="p-3 bg-muted rounded-md">
                      <p className="text-sm">
                        <span className="font-medium">Type:</span> {adminRole.roleType === 'super_admin' ? 'Super Admin' : 'Organization Admin'}
                      </p>
                      {adminRole.organizationId && (
                        <p className="text-sm mt-1">
                          <span className="font-medium">Organization:</span> {adminRole.orgName || `Organization ${adminRole.organizationId}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Phone Number */}
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  {isEditing ? (
                    <Input
                      type="tel"
                      value={editedUser.phoneNumber || ''}
                      onChange={(e) => setEditedUser({ ...editedUser, phoneNumber: e.target.value })}
                      placeholder="+1-555-0100"
                      data-testid="input-edit-phone"
                    />
                  ) : (
                    <p className="text-sm text-foreground">{user.phoneNumber || 'Not set'}</p>
                  )}
                </div>

                {/* Status */}
                <div className="space-y-2">
                  <Label>Account Status</Label>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editedUser.isActive}
                        onCheckedChange={(checked) => setEditedUser({ ...editedUser, isActive: checked })}
                        data-testid="switch-edit-active"
                      />
                      <span className="text-sm text-muted-foreground">{editedUser.isActive ? 'Active' : 'Inactive'}</span>
                    </div>
                  ) : (
                    <div>
                      {user.isActive ? (
                        <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Member Since</Label>
                  <p className="text-sm text-foreground">{user.createdDate}</p>
                </div>

                {user.lastLogin && (
                  <div className="space-y-2">
                    <Label>Last Login</Label>
                    <p className="text-sm text-foreground">{user.lastLogin}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Admin Role Assignment (Super Admin Only) */}
          {currentUser?.username === 'admin' && !adminRole && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="w-5 h-5" />
                  Admin Role Assignment
                </CardTitle>
                <CardDescription>Assign admin role to this user (Super Admin only)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isAssigningRole ? (
                  <Button onClick={() => setIsAssigningRole(true)}>
                    <Shield className="w-4 h-4 mr-2" />
                    Assign Admin Role
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Role Type</Label>
                      <Select
                        value={roleAssignment.roleType}
                        onValueChange={(value) => setRoleAssignment({
                          roleType: value as 'super_admin' | 'org_admin',
                          organizationId: value === 'super_admin' ? null : roleAssignment.organizationId
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select role type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin (All Organizations)</SelectItem>
                          <SelectItem value="org_admin">Organization Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {roleAssignment.roleType === 'org_admin' && (
                      <div className="space-y-2">
                        <Label>Organization</Label>
                        <Select
                          value={roleAssignment.organizationId?.toString() || ''}
                          onValueChange={(value) => setRoleAssignment({
                            ...roleAssignment,
                            organizationId: parseInt(value)
                          })}
                        >
                          <SelectTrigger>
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
                    )}
                    <div className="flex gap-2">
                      <Button onClick={handleAssignRole} disabled={assignRoleMutation.isPending}>
                        {assignRoleMutation.isPending ? 'Assigning...' : 'Assign Role'}
                      </Button>
                      <Button variant="outline" onClick={() => {
                        setIsAssigningRole(false);
                        setRoleAssignment({ roleType: '', organizationId: null });
                      }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notification Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notification Preferences
              </CardTitle>
              <CardDescription>Configure how you receive alerts and notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Notification Method */}
                <div className="space-y-2">
                  <Label>Notification Method</Label>
                  {isEditing ? (
                    <Select
                      value={editedUser.notificationPreference}
                      onValueChange={(value) => setEditedUser({ ...editedUser, notificationPreference: value })}
                    >
                      <SelectTrigger data-testid="select-edit-notification">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="email">Email Only</SelectItem>
                        <SelectItem value="sms">SMS Only</SelectItem>
                        <SelectItem value="both">Email & SMS</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-foreground capitalize">{user.notificationPreference}</p>
                  )}
                </div>

                {/* Alert Filter */}
                <div className="space-y-2">
                  <Label>Alert Severity Filter</Label>
                  {isEditing ? (
                    <Select
                      value={editedUser.alertFilters.severity}
                      onValueChange={(value) => setEditedUser({
                        ...editedUser,
                        alertFilters: { ...editedUser.alertFilters, severity: value }
                      })}
                    >
                      <SelectTrigger data-testid="select-edit-alert-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Alerts</SelectItem>
                        <SelectItem value="critical">Critical Only</SelectItem>
                        <SelectItem value="warning">Warning & Above</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-foreground capitalize">{user.alertFilters.severity}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Quiet Mode */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <BellOff className="w-4 h-4 text-muted-foreground" />
                  <Label>Quiet Hours</Label>
                </div>

                <div className="space-y-2">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editedUser.quietModeEnabled}
                        onCheckedChange={(checked) => setEditedUser({ ...editedUser, quietModeEnabled: checked })}
                        data-testid="switch-edit-quiet-mode"
                      />
                      <span className="text-sm text-muted-foreground">
                        {editedUser.quietModeEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-foreground">
                      {user.quietModeEnabled ? 'Enabled' : 'Disabled'}
                    </p>
                  )}
                </div>

                {((isEditing && editedUser.quietModeEnabled) || (!isEditing && user.quietModeEnabled)) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      {isEditing ? (
                        <Input
                          type="time"
                          value={editedUser.quietHoursStart}
                          onChange={(e) => setEditedUser({ ...editedUser, quietHoursStart: e.target.value })}
                          data-testid="input-edit-quiet-start"
                        />
                      ) : (
                        <p className="text-sm text-foreground">{user.quietHoursStart}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      {isEditing ? (
                        <Input
                          type="time"
                          value={editedUser.quietHoursEnd}
                          onChange={(e) => setEditedUser({ ...editedUser, quietHoursEnd: e.target.value })}
                          data-testid="input-edit-quiet-end"
                        />
                      ) : (
                        <p className="text-sm text-foreground">{user.quietHoursEnd}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Security & Password Reset - Admin Only */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Reset Password
              </CardTitle>
              <CardDescription>Reset this user's password (admin override)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* New Password */}
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordResetData.newPassword}
                    onChange={(e) => setPasswordResetData({ ...passwordResetData, newPassword: e.target.value })}
                    placeholder="Enter new password (min 8 characters)"
                    data-testid="input-reset-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    data-testid="button-toggle-reset-password"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordResetData.confirmPassword}
                    onChange={(e) => setPasswordResetData({ ...passwordResetData, confirmPassword: e.target.value })}
                    placeholder="Confirm new password"
                    data-testid="input-confirm-reset-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    data-testid="button-toggle-confirm-reset-password"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button onClick={handlePasswordReset} variant="destructive" data-testid="button-reset-password">
                Reset User Password
              </Button>
            </CardContent>
          </Card>

          {/* Permissions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Permissions
              </CardTitle>
              <CardDescription>Granular access control for system features</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(AVAILABLE_PERMISSIONS).map(([category, perms]) => (
                  <div key={category} className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">{category}</h4>
                    <div className="space-y-2 pl-4">
                      {perms.map((perm) => {
                        const hasPermission = (isEditing ? editedUser : user).permissions.includes(perm.id);
                        return (
                          <div key={perm.id} className="flex items-center space-x-2">
                            {isEditing ? (
                              <Checkbox
                                id={perm.id}
                                checked={hasPermission}
                                onCheckedChange={() => togglePermission(perm.id)}
                                data-testid={`checkbox-permission-${perm.id}`}
                              />
                            ) : (
                              <div className={`w-4 h-4 rounded border ${hasPermission ? 'bg-indigo-600 border-indigo-600' : 'bg-card border-border'}`}>
                                {hasPermission && (
                                  <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <label
                              htmlFor={perm.id}
                              className="text-sm text-foreground cursor-pointer"
                            >
                              {perm.label}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Permissions</span>
                <Badge variant="secondary">{user.permissions.length}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Notifications</span>
                <Badge variant="secondary" className="capitalize">{user.notificationPreference}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Quiet Mode</span>
                <Badge variant="secondary">{user.quietModeEnabled ? 'On' : 'Off'}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">Last login: {user.lastLogin || 'Never'}</p>
                <p className="text-muted-foreground">Account created: {user.createdDate}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

