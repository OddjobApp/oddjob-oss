import { useState, useEffect } from 'react';
import { User, Pencil, X, Save, BellOff, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { TIMEZONES as ALL_TIMEZONES } from '@/lib/timezones';

// Use comprehensive timezone list
const TIMEZONES = ALL_TIMEZONES;

export default function Profile() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<any>({});

  // Fetch current user profile
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['/api/users/current'],
    queryFn: async () => {
      const res = await fetch('/api/users/current');
      if (!res.ok) {
        throw new Error('Failed to fetch current user');
      }
      return res.json();
    },
  });

  // Initialize edited data when user data loads
  useEffect(() => {
    if (user && !isEditing) {
      setEditedData({
        email: user.email || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        slackHandle: user.slackHandle || null,
        quietHoursEnabled: user.quietHoursEnabled || false,
        quietHoursStart: user.quietHoursStart || null,
        quietHoursEnd: user.quietHoursEnd || null,
        quietHoursTimezone: user.quietHoursTimezone || null,
      });
    }
  }, [user, isEditing]);

  // Update user mutation
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!user?.id) {
        throw new Error('No user ID available');
      }
      const response = await apiRequest('PATCH', `/api/users/${user.id}`, data);
      const responseData = await response.json();
      return responseData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/current'] });
      setIsEditing(false);
      toast({
        title: 'Profile updated',
        description: 'Your profile has been successfully updated.',
      });
    },
    onError: (error: any) => {
      console.error('[Profile] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      toast({
        title: 'Update failed',
        description: error.message || 'Failed to update profile. Please check the console for details.',
        variant: 'destructive',
      });
    },
  });

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (user) {
      setEditedData({
        email: user.email || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        slackHandle: user.slackHandle || null,
        quietHoursEnabled: user.quietHoursEnabled || false,
        quietHoursStart: user.quietHoursStart || null,
        quietHoursEnd: user.quietHoursEnd || null,
        quietHoursTimezone: user.quietHoursTimezone || null,
      });
    }
    setIsEditing(false);
    toast({
      title: 'Changes discarded',
      description: 'Your edits have been cancelled.',
    });
  };

  const handleSave = () => {
    // Validate email if provided
    if (editedData.email && editedData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editedData.email)) {
      toast({
        title: 'Invalid email',
        description: 'Please enter a valid email address.',
        variant: 'destructive',
      });
      return;
    }

    // Validate quiet hours times if enabled
    if (editedData.quietHoursEnabled) {
      // Use default values if not set (from the input display defaults)
      const startTime = (editedData.quietHoursStart?.trim() || '22:00').trim();
      const endTime = (editedData.quietHoursEnd?.trim() || '08:00').trim();
      
      // Validate time format (HH:MM)
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        toast({
          title: 'Invalid time format',
          description: 'Please use HH:MM format (24-hour) for times.',
          variant: 'destructive',
        });
        return;
      }
      
      // Update the editedData with the actual values to use
      editedData.quietHoursStart = startTime;
      editedData.quietHoursEnd = endTime;
    }

    // Prepare data for API - only send fields that have changed or are required
    const updateData: any = {};

    // Always include these if they exist in editedData
    if ('email' in editedData) updateData.email = editedData.email || null;
    if ('firstName' in editedData) updateData.firstName = editedData.firstName || null;
    if ('lastName' in editedData) updateData.lastName = editedData.lastName || null;
    if ('slackHandle' in editedData) updateData.slackHandle = editedData.slackHandle || null;
    
    // Quiet hours fields
    if ('quietHoursEnabled' in editedData) {
      updateData.quietHoursEnabled = editedData.quietHoursEnabled || false;
    }
    
    if (editedData.quietHoursEnabled) {
      // Use the validated values (which now have defaults applied)
      updateData.quietHoursStart = editedData.quietHoursStart || '22:00';
      updateData.quietHoursEnd = editedData.quietHoursEnd || '08:00';
      updateData.quietHoursTimezone = editedData.quietHoursTimezone || 'UTC';
    } else {
      // If disabling quiet hours, set these to null
      updateData.quietHoursStart = null;
      updateData.quietHoursEnd = null;
      updateData.quietHoursTimezone = null;
    }

    updateMutation.mutate(updateData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>Failed to load profile</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const displayName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user?.username || 'User Profile';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground" data-testid="text-profile-heading">
            {displayName}
          </h1>
          <p className="text-muted-foreground mt-1">Manage your account profile and preferences</p>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <Button onClick={handleEdit} data-testid="button-edit">
              <Pencil className="w-4 h-4 mr-2" />
              Edit Profile
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleCancel} data-testid="button-cancel" disabled={updateMutation.isPending}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }} 
                data-testid="button-save" 
                disabled={updateMutation.isPending}
                type="button"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Basic Information
            </CardTitle>
            <CardDescription>Your personal details and account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {/* First Name */}
              <div className="space-y-2">
                <Label>First Name</Label>
                {isEditing ? (
                  <Input
                    type="text"
                    value={editedData.firstName || ''}
                    onChange={(e) => setEditedData({ ...editedData, firstName: e.target.value })}
                    placeholder="John"
                    data-testid="input-edit-firstname"
                  />
                ) : (
                  <p className="text-sm text-foreground">{user?.firstName || 'Not set'}</p>
                )}
              </div>

              {/* Last Name */}
              <div className="space-y-2">
                <Label>Last Name</Label>
                {isEditing ? (
                  <Input
                    type="text"
                    value={editedData.lastName || ''}
                    onChange={(e) => setEditedData({ ...editedData, lastName: e.target.value })}
                    placeholder="Doe"
                    data-testid="input-edit-lastname"
                  />
                ) : (
                  <p className="text-sm text-foreground">{user?.lastName || 'Not set'}</p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label>Email</Label>
                {isEditing ? (
                  <Input
                    type="email"
                    value={editedData.email || ''}
                    onChange={(e) => setEditedData({ ...editedData, email: e.target.value })}
                    placeholder="user@example.com"
                    data-testid="input-edit-email"
                  />
                ) : (
                  <p className="text-sm text-foreground">{user?.email || 'Not set'}</p>
                )}
              </div>

              {/* Username (read-only) */}
              <div className="space-y-2">
                <Label>Username</Label>
                <p className="text-sm text-foreground">{user?.username || 'N/A'}</p>
              </div>

              {/* Slack Handle */}
              <div className="space-y-2">
                <Label>Slack Handle</Label>
                {isEditing ? (
                  <Input
                    type="text"
                    value={editedData.slackHandle || ''}
                    onChange={(e) => setEditedData({ ...editedData, slackHandle: e.target.value })}
                    placeholder="@username (without @)"
                    data-testid="input-edit-slack-handle"
                  />
                ) : (
                  <p className="text-sm text-foreground">{user?.slackHandle ? `@${user.slackHandle}` : 'Not set'}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Used to identify you in Slack interactions with the Oddjob agent.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quiet Hours */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellOff className="w-5 h-5" />
              Quiet Hours
            </CardTitle>
            <CardDescription>Configure when you don't want to receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editedData.quietHoursEnabled || false}
                    onCheckedChange={(checked) => {
                      const updatedData = { ...editedData, quietHoursEnabled: checked };
                      // When enabling quiet hours, set default values if they don't exist
                      if (checked) {
                        if (!updatedData.quietHoursStart) updatedData.quietHoursStart = '22:00';
                        if (!updatedData.quietHoursEnd) updatedData.quietHoursEnd = '08:00';
                        if (!updatedData.quietHoursTimezone) updatedData.quietHoursTimezone = 'UTC';
                      }
                      setEditedData(updatedData);
                    }}
                    data-testid="switch-edit-quiet-hours"
                  />
                  <span className="text-sm text-muted-foreground">
                    {editedData.quietHoursEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-foreground">
                  {user?.quietHoursEnabled ? 'Enabled' : 'Disabled'}
                </p>
              )}
            </div>

            {((isEditing && editedData.quietHoursEnabled) || (!isEditing && user?.quietHoursEnabled)) && (
              <>
                <Separator />
                <div className="grid grid-cols-3 gap-4">
                  {/* Start Time */}
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    {isEditing ? (
                      <Input
                        type="time"
                        value={editedData.quietHoursStart || '22:00'}
                        onChange={(e) => setEditedData({ ...editedData, quietHoursStart: e.target.value })}
                        data-testid="input-edit-quiet-start"
                      />
                    ) : (
                      <p className="text-sm text-foreground">{user?.quietHoursStart || '22:00'}</p>
                    )}
                  </div>

                  {/* End Time */}
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    {isEditing ? (
                      <Input
                        type="time"
                        value={editedData.quietHoursEnd || '08:00'}
                        onChange={(e) => setEditedData({ ...editedData, quietHoursEnd: e.target.value })}
                        data-testid="input-edit-quiet-end"
                      />
                    ) : (
                      <p className="text-sm text-foreground">{user?.quietHoursEnd || '08:00'}</p>
                    )}
                  </div>

                  {/* Timezone */}
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    {isEditing ? (
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={editedData.quietHoursTimezone || 'UTC'}
                        onChange={(e) => setEditedData({ ...editedData, quietHoursTimezone: e.target.value })}
                        data-testid="select-edit-timezone"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm text-foreground">{user?.quietHoursTimezone || 'UTC'}</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        {/* Conversational Identities */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Conversational Identities
            </CardTitle>
            <CardDescription>Manage your connections to Slack, Teams, and other messaging platforms</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-card rounded-md shadow-sm border">
                  <svg className="w-6 h-6" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.4 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.4c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.4 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C77.6 5.8 83.4 0 90.5 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.4c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>
                </div>
                <div>
                  <p className="font-medium">Slack Connection</p>
                  <p className="text-sm text-muted-foreground">Used for launching missions and receiving alerts via Slack threads.</p>
                </div>
              </div>
              <div>
                <Button variant="outline" size="sm" className="gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                  Connected
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              * Your identity is paired by setting your Slack Handle above. This allows the Oddjob agent to recognize you in Slack.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


