"""
Quiet Hours Utility Functions

Functions to check if alerts should be suppressed based on user quiet hours
and organization suppression policies.
"""

from datetime import datetime
from typing import Optional, Dict, Any, Tuple

# Timezone support - use zoneinfo for Python 3.9+, fallback to pytz
try:
    from zoneinfo import ZoneInfo
except ImportError:
    try:
        from backports.zoneinfo import ZoneInfo
    except ImportError:
        # Fallback to pytz if zoneinfo not available
        try:
            import pytz
            def ZoneInfo(tz_name: str):
                return pytz.timezone(tz_name)
        except ImportError:
            # If neither available, raise helpful error
            raise ImportError("Either zoneinfo (Python 3.9+) or pytz package required for timezone support")


def is_within_quiet_hours(
    start_time: str,
    end_time: str,
    timezone: str
) -> bool:
    """
    Check if current time is within a quiet hours time range.
    
    Args:
        start_time: Start time in HH:MM format (24-hour)
        end_time: End time in HH:MM format (24-hour)
        timezone: IANA timezone string (e.g., "America/New_York")
    
    Returns:
        True if current time falls within the quiet hours window
    """
    try:
        # Parse start and end times
        start_parts = start_time.split(':')
        end_parts = end_time.split(':')
        
        if len(start_parts) != 2 or len(end_parts) != 2:
            print(f"[quiet-hours] Invalid time format: {start_time}, {end_time}")
            return False
        
        start_hour = int(start_parts[0])
        start_minute = int(start_parts[1])
        end_hour = int(end_parts[0])
        end_minute = int(end_parts[1])
        
        # Get current time in the specified timezone
        try:
            tz = ZoneInfo(timezone)
        except (ValueError, AttributeError, Exception) as e:
            print(f"[quiet-hours] Invalid timezone: {timezone}, error: {e}")
            return False
        
        now = datetime.now(tz)
        current_hour = now.hour
        current_minute = now.minute
        
        current_time_minutes = current_hour * 60 + current_minute
        start_time_minutes = start_hour * 60 + start_minute
        end_time_minutes = end_hour * 60 + end_minute
        
        # Handle ranges that span midnight (e.g., 22:00 to 08:00)
        if start_time_minutes > end_time_minutes:
            # Range spans midnight: check if current time is >= start OR <= end
            return current_time_minutes >= start_time_minutes or current_time_minutes <= end_time_minutes
        else:
            # Normal range: check if current time is within start and end
            return current_time_minutes >= start_time_minutes and current_time_minutes <= end_time_minutes
            
    except Exception as e:
        print(f"[quiet-hours] Error checking quiet hours: {e}")
        return False


def should_suppress_alert_for_user(
    user: Dict[str, Any],
    alert_severity: str
) -> Tuple[bool, Optional[str]]:
    """
    Check if an alert should be suppressed based on user's quiet hours settings.
    
    Args:
        user: User dict with quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone
        alert_severity: Alert severity (info, warn, error, critical)
    
    Returns:
        Tuple of (suppress: bool, reason: Optional[str])
    """
    if not user.get('quiet_hours_enabled'):
        return False, None
    
    start_time = user.get('quiet_hours_start')
    end_time = user.get('quiet_hours_end')
    timezone = user.get('quiet_hours_timezone')
    
    if not start_time or not end_time or not timezone:
        return False, None
    
    is_within = is_within_quiet_hours(start_time, end_time, timezone)
    
    if is_within:
        reason = f"Quiet hours: User quiet hours active ({start_time}-{end_time} {timezone})"
        return True, reason
    
    return False, None


def should_suppress_alert_for_org(
    suppression_policy: Optional[Dict[str, Any]],
    alert_severity: str
) -> Tuple[bool, Optional[str]]:
    """
    Check if an alert should be suppressed based on organization's suppression policy.
    
    Args:
        suppression_policy: Suppression policy dict with enable_quiet_hours, enable_severity_bypass, quiet_hours_bypass_severities
        alert_severity: Alert severity (info, warn, error, critical)
    
    Returns:
        Tuple of (suppress: bool, reason: Optional[str])
    """
    if not suppression_policy or not suppression_policy.get('enable_quiet_hours'):
        return False, None
    
    # Check severity bypass
    if suppression_policy.get('enable_severity_bypass'):
        bypass_severities = suppression_policy.get('quiet_hours_bypass_severities', [])
        if bypass_severities and alert_severity.lower() in [s.lower() for s in bypass_severities]:
            return False, f"Organization policy: Severity '{alert_severity}' bypasses quiet hours"
    
    # Note: Org policies don't have time ranges, so they only provide bypass logic
    return False, None


def should_suppress_alert(
    user: Optional[Dict[str, Any]],
    org_suppression_policy: Optional[Dict[str, Any]],
    alert_severity: str
) -> Tuple[bool, Optional[str]]:
    """
    Determine if an alert should be suppressed based on both user and organization settings.
    Uses OR logic: suppress if EITHER user quiet hours OR org policy indicates suppression.
    
    Args:
        user: User dict with quiet hours settings
        org_suppression_policy: Organization suppression policy dict (optional)
        alert_severity: Alert severity (info, warn, error, critical)
    
    Returns:
        Tuple of (suppress: bool, reason: Optional[str])
    """
    # Check user-level quiet hours
    if user:
        suppress, reason = should_suppress_alert_for_user(user, alert_severity)
        if suppress:
            return True, reason
    
    # Check org-level suppression policy
    if org_suppression_policy:
        suppress, reason = should_suppress_alert_for_org(org_suppression_policy, alert_severity)
        # If org policy says to bypass, don't suppress
        if reason and 'bypasses' in reason:
            return False, None
        # Note: Currently org policies don't have time ranges, so they only provide bypass logic
    
    return False, None

