"""
Scheduler Service

Background service that polls the database for scheduled jobs and triggers their execution
when their schedule time arrives.
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from calendar import monthrange
from typing import Optional
from dotenv import load_dotenv
import asyncpg
from croniter import croniter
import json
from quiet_hours import should_suppress_alert

# Timezone support - use zoneinfo for Python 3.9+, fallback to pytz
try:
    from zoneinfo import ZoneInfo
except ImportError:
    try:
        from backports.zoneinfo import ZoneInfo
    except ImportError:
        # Fallback to pytz if zoneinfo not available
        import pytz
        def ZoneInfo(tz_name: str):
            return pytz.timezone(tz_name)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

POLL_INTERVAL_SECONDS = 60  # Poll every minute
SCHEDULER_USER_ID = "scheduler"


def parse_starttime(starttime: str) -> tuple[int, int]:
    """Parse starttime string in 'HH:MM' format and return (hour, minute)."""
    try:
        parts = starttime.split(':')
        if len(parts) != 2:
            raise ValueError(f"Invalid time format: {starttime}")
        hour = int(parts[0])
        minute = int(parts[1])
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError(f"Invalid time values: {starttime}")
        return hour, minute
    except (ValueError, AttributeError) as e:
        raise ValueError(f"Failed to parse starttime '{starttime}': {e}")


def get_timezone(tz_string: Optional[str]) -> timezone:
    """Get timezone object from timezone string. Defaults to UTC."""
    if not tz_string:
        return timezone.utc
    try:
        return ZoneInfo(tz_string)
    except Exception as e:
        print(f"Warning: Invalid timezone '{tz_string}', using UTC: {e}")
        return timezone.utc


def calculate_next_fire_time(schedule: dict) -> Optional[datetime]:
    """Calculate next fire time for a schedule. Returns UTC datetime."""
    if not schedule.get("is_active"):
        return None
    
    # Get schedule timezone, default to UTC
    schedule_tz = get_timezone(schedule.get("timezone"))
    
    # Get current time in UTC
    now_utc = datetime.now(timezone.utc)
    # Convert to schedule timezone for calculations
    now_tz = now_utc.astimezone(schedule_tz)
    
    pattern = schedule.get("pattern")
    pattern_string = schedule.get("pattern_string") or {}
    
    # Helper to extract hour and minute from pattern_string
    def get_hour_minute():
        # Try new format first: starttime as "HH:MM" string
        if "starttime" in pattern_string:
            try:
                return parse_starttime(pattern_string["starttime"])
            except ValueError as e:
                print(f"Warning: Failed to parse starttime, using defaults: {e}")
        # Fallback to legacy format: hour and minute as integers
        hour = pattern_string.get("hour", 0)
        minute = pattern_string.get("minute", 0)
        return hour, minute
    
    # Pattern 1: Daily
    if pattern == 1:
        hour, minute = get_hour_minute()
        # Create datetime in schedule timezone
        next_time_tz = now_tz.replace(hour=hour, minute=minute, second=0, microsecond=0)
        # Compare as timezone-aware datetimes
        if next_time_tz <= now_tz:
            next_time_tz = next_time_tz + timedelta(days=1)
        # Convert to UTC for storage
        return next_time_tz.astimezone(timezone.utc)
    
    # Pattern 2: Weekly
    if pattern == 2:
        hour, minute = get_hour_minute()
        
        # Handle weekdays - can be comma-separated string or single value
        weekdays_str = pattern_string.get("weekdays", "")
        day_of_week = pattern_string.get("dayOfWeek", 0)  # Legacy format
        
        # Parse weekdays if present (comma-separated string like "1,2,3")
        if weekdays_str:
            try:
                # Split by comma and take first weekday
                weekday_list = [int(d.strip()) for d in weekdays_str.split(',') if d.strip()]
                if weekday_list:
                    # Convert from Monday=1 to Sunday=0 format
                    # Frontend uses: 1=Mon, 2=Tue, ..., 7=Sun
                    # Scheduler expects: 0=Sun, 1=Mon, ..., 6=Sat
                    first_weekday = weekday_list[0]
                    if first_weekday == 7:  # Sunday in frontend
                        day_of_week = 0
                    else:
                        day_of_week = first_weekday  # Mon-Sat map directly
            except (ValueError, AttributeError):
                pass  # Fall back to dayOfWeek if parsing fails
        
        # Create datetime in schedule timezone
        next_time_tz = now_tz.replace(hour=hour, minute=minute, second=0, microsecond=0)
        current_day = next_time_tz.weekday()
        # Convert to Sunday=0 format (Python weekday: Mon=0, Sun=6)
        current_day_sunday = (current_day + 1) % 7
        days_until_next = (day_of_week - current_day_sunday + 7) % 7
        if days_until_next == 0 and next_time_tz <= now_tz:
            days_until_next = 7
        next_time_tz = next_time_tz + timedelta(days=days_until_next)
        # Convert to UTC for storage
        return next_time_tz.astimezone(timezone.utc)
    
    # Pattern 3: Monthly
    if pattern == 3:
        hour, minute = get_hour_minute()
        
        # Handle both dayofmonth and dayOfMonth (case-insensitive)
        day_of_month = pattern_string.get("dayOfMonth") or pattern_string.get("dayofmonth", 1)
        
        # Clamp day_of_month to the maximum valid day for the current month
        _, max_day = monthrange(now_tz.year, now_tz.month)
        clamped_day = min(day_of_month, max_day)
        
        # Try to set the date in the current month first
        try:
            next_time_tz = now_tz.replace(day=clamped_day, hour=hour, minute=minute, second=0, microsecond=0)
        except ValueError:
            # This shouldn't happen with clamped_day, but handle it just in case
            next_time_tz = now_tz.replace(day=max_day, hour=hour, minute=minute, second=0, microsecond=0)
        
        # Compare as timezone-aware datetimes
        if next_time_tz <= now_tz:
            # Move to next month
            if next_time_tz.month == 12:
                next_year = next_time_tz.year + 1
                next_month = 1
            else:
                next_year = next_time_tz.year
                next_month = next_time_tz.month + 1
            
            # Clamp day_of_month to the maximum valid day for the next month
            _, max_day_next = monthrange(next_year, next_month)
            clamped_day_next = min(day_of_month, max_day_next)
            
            next_time_tz = next_time_tz.replace(year=next_year, month=next_month, day=clamped_day_next)
        
        # Convert to UTC for storage
        return next_time_tz.astimezone(timezone.utc)
    
    # Pattern 4: Custom Cron
    if pattern == 4:
        cron_expr = pattern_string.get("cron", "")
        if cron_expr:
            try:
                # Croniter works with naive datetime
                # Use current time in schedule timezone (as naive) for calculation
                now_naive = now_tz.replace(tzinfo=None)
                cron = croniter(cron_expr, now_naive)
                next_time_naive = cron.get_next(datetime)
                # Make timezone-aware in schedule timezone, then convert to UTC
                # Handle both zoneinfo and pytz timezone objects
                try:
                    # Try zoneinfo style (Python 3.9+) - zoneinfo can use replace
                    if isinstance(schedule_tz, timezone):
                        # Already a timezone object
                        next_time_tz = next_time_naive.replace(tzinfo=schedule_tz)
                    else:
                        # ZoneInfo or pytz object
                        try:
                            next_time_tz = next_time_naive.replace(tzinfo=schedule_tz)
                        except (TypeError, AttributeError):
                            # Fall back to pytz style
                            if hasattr(schedule_tz, 'localize'):
                                next_time_tz = schedule_tz.localize(next_time_naive)
                            else:
                                # If neither works, assume UTC
                                next_time_tz = next_time_naive.replace(tzinfo=timezone.utc)
                except Exception as e:
                    print(f"Warning: Error setting timezone for cron result: {e}, using UTC")
                    next_time_tz = next_time_naive.replace(tzinfo=timezone.utc)
                return next_time_tz.astimezone(timezone.utc)
            except Exception as e:
                print(f"Error parsing cron expression {cron_expr}: {e}")
                import traceback
                traceback.print_exc()
                return None
        return None
    
    return None


async def update_schedule_trigger(conn: asyncpg.Connection, scheduled_job_id: int, schedule: dict):
    """Update or create schedule trigger for a scheduled job."""
    next_fire_at = calculate_next_fire_time(schedule)
    if not next_fire_at:
        return
    
    # Ensure datetime is timezone-aware and convert to UTC for database storage
    if next_fire_at.tzinfo is None:
        next_fire_at = next_fire_at.replace(tzinfo=timezone.utc)
    else:
        next_fire_at = next_fire_at.astimezone(timezone.utc)
    
    # Create a fresh datetime object with timezone.utc to avoid asyncpg encoding issues
    # Extract the UTC components and create a new datetime
    next_fire_at_utc = datetime(
        next_fire_at.year,
        next_fire_at.month,
        next_fire_at.day,
        next_fire_at.hour,
        next_fire_at.minute,
        next_fire_at.second,
        next_fire_at.microsecond,
        tzinfo=timezone.utc
    )
    
    existing = await conn.fetchrow(
        "SELECT trigger_id FROM schedule_triggers WHERE scheduled_job_id = $1",
        scheduled_job_id
    )
    
    if existing:
        await conn.execute(
            """
            UPDATE schedule_triggers 
            SET next_fire_at = $1::timestamptz, computed_at = NOW()
            WHERE scheduled_job_id = $2
            """,
            next_fire_at_utc, scheduled_job_id
        )
    else:
        await conn.execute(
            """
            INSERT INTO schedule_triggers (scheduled_job_id, next_fire_at)
            VALUES ($1, $2::timestamptz)
            """,
            scheduled_job_id, next_fire_at_utc
        )


async def check_and_execute_scheduled_jobs(conn: asyncpg.Connection):
    """Check and execute scheduled jobs that are due."""
    try:
        # Use UTC for all time comparisons
        # Convert to timezone-aware UTC datetime for asyncpg
        now_utc = datetime.now(timezone.utc)
        
        # Find scheduled jobs that are due
        # PostgreSQL TIMESTAMPTZ comparison should work correctly
        # We pass timezone-aware UTC datetime and PostgreSQL handles conversion
        due_triggers = await conn.fetch("""
            SELECT 
                st.trigger_id,
                st.scheduled_job_id,
                st.next_fire_at,
                sj.name as scheduled_job_name,
                sj.job_id,
                sj.schedule_id,
                sj.max_concurrent_runs,
                sj.alert_on_failure,
                sj.owner_user_id,
                sj.owner_org_id,
                j.name as job_name,
                j.type as job_type
            FROM schedule_triggers st
            INNER JOIN scheduled_jobs sj ON st.scheduled_job_id = sj.scheduled_job_id
            INNER JOIN jobs j ON sj.job_id = j.id
            WHERE st.next_fire_at <= $1::timestamptz
                AND sj.is_active = true
                AND j.is_active = true
        """, now_utc)
        
        if due_triggers:
            print(f"Found {len(due_triggers)} due job(s) at {now_utc}", flush=True)
        
        for trigger in due_triggers:
            scheduled_job_id = trigger["scheduled_job_id"]
            
            # Check run lock to prevent concurrent execution
            lock = await conn.fetchrow(
                "SELECT in_progress FROM run_locks WHERE scheduled_job_id = $1",
                scheduled_job_id
            )
            
            if lock and lock["in_progress"] >= trigger["max_concurrent_runs"]:
                print(f"Skipping {trigger['scheduled_job_name']}: max concurrent runs reached")
                continue
            
            # Acquire lock
            if lock:
                await conn.execute(
                    """
                    UPDATE run_locks 
                    SET in_progress = in_progress + 1, updated_at = NOW()
                    WHERE scheduled_job_id = $1
                    """,
                    scheduled_job_id
                )
            else:
                await conn.execute(
                    "INSERT INTO run_locks (scheduled_job_id, in_progress) VALUES ($1, 1)",
                    scheduled_job_id
                )
            
            # Queue job for execution
            print(f"Queueing scheduled job: {trigger['scheduled_job_name']} (Job: {trigger['job_name']})")
            try:
                # Insert into work queue
                # item_id is bigserial (auto-generated), so we don't include it
                # Using RETURNING to verify the insert worked
                result = await conn.fetchrow("""
                    INSERT INTO work_queue (
                        scheduled_job_id, job_id, due_at, status, priority
                    ) VALUES ($1, $2, $3::timestamptz, $4, $5)
                    RETURNING item_id
                """, 
                    scheduled_job_id,
                    trigger["job_id"],
                    now_utc,
                    "ready",
                    2  # Default priority
                )
                if result:
                    print(f"Successfully queued job with item_id: {result['item_id']}")
                
                # Update next fire time
                schedule = await conn.fetchrow(
                    "SELECT * FROM schedules WHERE schedule_id = $1",
                    trigger["schedule_id"]
                )
                
                if schedule:
                    schedule_dict = dict(schedule)
                    if schedule_dict.get("pattern_string"):
                        schedule_dict["pattern_string"] = json.loads(schedule_dict["pattern_string"])
                    await update_schedule_trigger(conn, scheduled_job_id, schedule_dict)
                    print(f"Updated next fire time for {trigger['scheduled_job_name']}", flush=True)
                    
            except Exception as error:
                print(f"Error queueing scheduled job {trigger['scheduled_job_name']}: {error}", flush=True)
                import traceback
                traceback.print_exc()
                # Create alert on failure
                if trigger["alert_on_failure"]:
                    owner_user_id = trigger.get("owner_user_id") or SCHEDULER_USER_ID
                    owner_org_id = trigger.get("owner_org_id")
                    
                    # Fetch user quiet hours settings
                    user = None
                    if owner_user_id and owner_user_id != SCHEDULER_USER_ID:
                        user = await conn.fetchrow(
                            """
                            SELECT 
                                quiet_hours_enabled,
                                quiet_hours_start,
                                quiet_hours_end,
                                quiet_hours_timezone
                            FROM users
                            WHERE id = $1
                            """,
                            owner_user_id
                        )
                    
                    # Fetch organization suppression policy
                    org_suppression_policy = None
                    if owner_org_id:
                        org = await conn.fetchrow(
                            """
                            SELECT suppression_policy_id
                            FROM orgs
                            WHERE org_id = $1
                            """,
                            owner_org_id
                        )
                        
                        if org and org.get("suppression_policy_id"):
                            org_suppression_policy = await conn.fetchrow(
                                """
                                SELECT 
                                    enable_quiet_hours,
                                    enable_severity_bypass,
                                    quiet_hours_bypass_severities
                                FROM suppression_policies
                                WHERE policy_id = $1
                                """,
                                org["suppression_policy_id"]
                            )
                    
                    # Check if alert should be suppressed
                    suppress, suppress_reason = should_suppress_alert(
                        dict(user) if user else None,
                        dict(org_suppression_policy) if org_suppression_policy else None,
                        "critical"
                    )
                    
                    await conn.execute("""
                        INSERT INTO alerts (
                            severity, category, scheduled_job_id, message, details, 
                            owner_user_id, owner_org_id, suppressed, suppressed_reason
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """,
                        "critical",
                        "job_failure",
                        scheduled_job_id,
                        f"Scheduled job \"{trigger['scheduled_job_name']}\" failed to queue: {str(error)}",
                        json.dumps({"error": str(error)}),
                        owner_user_id,
                        owner_org_id,
                        suppress,
                        suppress_reason
                    )
            finally:
                # Release lock
                await conn.execute(
                    """
                    UPDATE run_locks 
                    SET in_progress = in_progress - 1, updated_at = NOW()
                    WHERE scheduled_job_id = $1
                    """,
                    scheduled_job_id
                )
                
    except Exception as error:
        print(f"Error in scheduler check: {error}")


async def initialize_schedule_triggers(conn: asyncpg.Connection):
    """Initialize schedule triggers for all active scheduled jobs."""
    print("Initializing schedule triggers...")
    
    try:
        active_scheduled_jobs = await conn.fetch("""
            SELECT sj.*, s.*
            FROM scheduled_jobs sj
            LEFT JOIN schedules s ON sj.schedule_id = s.schedule_id
            WHERE sj.is_active = true
                AND sj.trigger_type = 'Schedule'
        """)
        
        count = 0
        for row in active_scheduled_jobs:
            try:
                scheduled_job_id = row["scheduled_job_id"]
                schedule = dict(row)
                if schedule.get("pattern_string"):
                    if isinstance(schedule["pattern_string"], str):
                        schedule["pattern_string"] = json.loads(schedule["pattern_string"])
                    # If it's already a dict, keep it as is
                
                if schedule.get("schedule_id"):
                    print(f"Initializing trigger for scheduled_job_id {scheduled_job_id}, schedule_id {schedule.get('schedule_id')}")
                    await update_schedule_trigger(conn, scheduled_job_id, schedule)
                    count += 1
            except Exception as e:
                print(f"Error initializing trigger for scheduled_job_id {row.get('scheduled_job_id', 'unknown')}: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        print(f"Initialized {count} schedule triggers")
    except Exception as e:
        print(f"Error in initialize_schedule_triggers: {e}")
        import traceback
        traceback.print_exc()
        raise


async def main():
    """Main scheduler loop."""
    print("Starting scheduler service...", flush=True)
    
    conn = await asyncpg.connect(DATABASE_URL)
    print("Connected to database", flush=True)
    
    try:
        # Initialize triggers on startup
        await initialize_schedule_triggers(conn)
        print("Scheduler initialized. Polling for scheduled jobs...", flush=True)
        
        # Poll for due jobs
        poll_count = 0
        while True:
            try:
                poll_count += 1
                if poll_count % 10 == 0:  # Log every 10th poll (every 10 minutes)
                    print(f"Polling for scheduled jobs (poll #{poll_count})...", flush=True)
                await check_and_execute_scheduled_jobs(conn)
            except Exception as e:
                print(f"Error in check_and_execute_scheduled_jobs: {e}", flush=True)
                import traceback
                traceback.print_exc()
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            
    except KeyboardInterrupt:
        print("\nShutting down scheduler...", flush=True)
    except Exception as e:
        print(f"Fatal error in scheduler main loop: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Failed to start scheduler: {e}")
        sys.exit(1)
