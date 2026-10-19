"""
Alert Notification System
Email and webhook notifications for critical alerts
"""

import asyncio
import json
import os
import smtplib
import aiohttp
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from core.structured_logging import get_structured_logger
from core.config import settings

logger = get_structured_logger("alert_notifications")


@dataclass
class NotificationChannel:
    """Configuration for a notification channel."""
    id: str
    type: str  # 'email' or 'webhook'
    name: str
    enabled: bool = True

    # Email specific
    email_addresses: Optional[List[str]] = None

    # Webhook specific
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None

    # Filtering
    severity_filter: Optional[List[str]] = None  # ['high', 'critical']
    category_filter: Optional[List[str]] = None  # ['authentication', 'external_service']
import hmac
import hashlib
import base64

class NotificationManager:
    """Manages alert notifications via email and webhooks."""

    def __init__(self):
        self.channels: Dict[str, NotificationChannel] = {}
        self.notification_history: List[Dict[str, Any]] = []
        self.max_history = 1000

        # Email configuration
        self.smtp_server = getattr(settings, 'SMTP_SERVER', 'smtp.gmail.com')
        self.smtp_port = getattr(settings, 'SMTP_PORT', 587)
        self.smtp_username = getattr(settings, 'SMTP_USERNAME', None)
        self.smtp_password = getattr(settings, 'SMTP_PASSWORD', None)
        self.from_email = getattr(settings, 'FROM_EMAIL', 'alerts@oddjob.ai')

        # Initialize default channels
        self._setup_default_channels()

    def _setup_default_channels(self):
        """Setup default notification channels."""
        # Default email channel for critical alerts
        if self.smtp_username and self.smtp_password:
            self.add_channel(NotificationChannel(
                id="critical_email",
                type="email",
                name="Critical Alerts Email",
                email_addresses=["admin@oddjob.ai"],  # Default admin email
                severity_filter=["critical"]
            ))

        # Default webhook for all alerts (disabled by default)
        webhook_url = getattr(settings, 'ALERT_WEBHOOK_URL', None)
        if webhook_url:
            self.add_channel(NotificationChannel(
                id="default_webhook",
                type="webhook",
                name="Default Alert Webhook",
                webhook_url=webhook_url,
                severity_filter=["high", "critical"]
            ))

    def add_channel(self, channel: NotificationChannel) -> None:
        """Add a notification channel."""
        self.channels[channel.id] = channel
        logger.info(f"Added notification channel: {channel.name} ({channel.type})")

    def remove_channel(self, channel_id: str) -> bool:
        """Remove a notification channel."""
        if channel_id in self.channels:
            del self.channels[channel_id]
            logger.info(f"Removed notification channel: {channel_id}")
            return True
        return False

    def get_channels(self) -> List[NotificationChannel]:
        """Get all notification channels."""
        return list(self.channels.values())

    async def send_alert_notification(self, alert: Dict[str, Any]) -> None:
        """Send alert notification to all matching channels."""
        tasks = []

        for channel in self.channels.values():
            if not channel.enabled:
                continue

            if self._matches_filters(channel, alert):
                if channel.type == "email":
                    tasks.append(self._send_email_notification(channel, alert))
                elif channel.type == "webhook":
                    tasks.append(self._send_webhook_notification(channel, alert))
                elif channel.type == "slack":
                    tasks.append(self._send_slack_notification(channel, alert))
                elif channel.type == "agentmail":
                    tasks.append(self._send_agentmail_notification(channel, alert))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        else:
            logger.debug("No matching notification channels found for alert")

    def _matches_filters(self, channel: NotificationChannel, alert: Dict[str, Any]) -> bool:
        """Check if alert matches channel filters."""
        severity = alert.get('severity', '').lower()
        category = alert.get('category', '').lower()

        # Severity filter
        if channel.severity_filter:
            if severity not in [s.lower() for s in channel.severity_filter]:
                return False

        # Category filter
        if channel.category_filter:
            if category not in [c.lower() for c in channel.category_filter]:
                return False

        return True

    async def _send_email_notification(self, channel: NotificationChannel, alert: Dict[str, Any]) -> None:
        """Send email notification."""
        if not channel.email_addresses or not self.smtp_username:
            return

        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = f"🚨 Oddjob Alert: {alert['title']}"
            msg['From'] = self.from_email
            msg['To'] = ', '.join(channel.email_addresses)

            # HTML body
            html_body = self._create_email_html(alert)
            msg.attach(MIMEText(html_body, 'html'))

            # Send email
            if not self.smtp_username or not self.smtp_password:
                raise ValueError("SMTP credentials not configured")

            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(str(self.smtp_username), str(self.smtp_password))
            server.sendmail(self.from_email, channel.email_addresses, msg.as_string())
            server.quit()

            # Record notification
            self._record_notification(channel.id, "email", alert, "success")

            logger.info(f"Email alert sent to {len(channel.email_addresses)} recipients")

        except Exception as e:
            logger.error(f"Failed to send email notification: {e}")
            self._record_notification(channel.id, "email", alert, "failed", str(e))

    async def _send_webhook_notification(self, channel: NotificationChannel, alert: Dict[str, Any]) -> None:
        """Send webhook notification."""
        if not channel.webhook_url:
            return

        try:
            # Prepare payload
            payload = {
                "alert": alert,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "oddjob-backend",
                "version": settings.VERSION
            }

            # Prepare headers
            headers = {"Content-Type": "application/json"}
            if channel.webhook_headers:
                headers.update(channel.webhook_headers)

            # Send webhook
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    channel.webhook_url,
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status >= 200 and response.status < 300:
                        self._record_notification(channel.id, "webhook", alert, "success")
                        logger.info(f"Webhook alert sent to {channel.webhook_url}")
                    else:
                        response_text = await response.text()
                        raise Exception(f"HTTP {response.status}: {response_text}")

        except Exception as e:
            logger.error(f"Failed to send webhook notification: {e}")
            self._record_notification(channel.id, "webhook", alert, "failed", str(e))

    async def _send_slack_notification(self, channel: NotificationChannel, alert: Dict[str, Any]) -> None:
        """Send Slack notification."""
        # Use webhook_url as the Slack Webhook URL if type is slack
        webhook_url = channel.webhook_url or os.getenv("SLACK_WEBHOOK_URL")
        if not webhook_url:
            # Fallback to Web API if token is available
            bot_token = settings.SLACK_BOT_TOKEN
            if bot_token:
                await self._send_slack_web_api(channel, alert, bot_token)
                return
            return

        try:
            severity = alert.get('severity', 'medium').upper()
            payload = {
                "text": f"🚨 *{severity} Alert*: {alert.get('title')}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"🚨 *{severity} Alert*: {alert.get('title')}\n\n>{alert.get('description')}\n\n*Reason*: {alert.get('reason')}"
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"*ID*: {alert.get('id')} | *Category*: {alert.get('category')} | *Time*: {alert.get('timestamp')}"
                            }
                        ]
                    }
                ]
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(webhook_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status >= 200 and response.status < 300:
                        self._record_notification(channel.id, "slack", alert, "success")
                        logger.info(f"Slack alert sent via webhook")
                    else:
                        response_text = await response.text()
                        raise Exception(f"HTTP {response.status}: {response_text}")
        except Exception as e:
            logger.error(f"Failed to send Slack notification: {e}")
            self._record_notification(channel.id, "slack", alert, "failed", str(e))

    async def _send_slack_web_api(self, channel: NotificationChannel, alert: Dict[str, Any], token: str) -> None:
        """Send Slack notification via Web API."""
        # Default channel if not specified
        target_channel = channel.name if channel.name.startswith("#") or channel.name.startswith("C") else "#alerts"
        
        try:
            severity = alert.get('severity', 'medium').upper()
            payload = {
                "channel": target_channel,
                "text": f"🚨 *{severity} Alert*: {alert.get('title')}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"🚨 *{severity} Alert*: {alert.get('title')}\n\n>{alert.get('description')}\n\n*Reason*: {alert.get('reason')}"
                        }
                    }
                ]
            }

            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            async with aiohttp.ClientSession() as session:
                async with session.post("https://slack.com/api/chat.postMessage", json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    res_json = await response.json()
                    if res_json.get("ok"):
                        self._record_notification(channel.id, "slack", alert, "success")
                    else:
                        raise Exception(f"Slack API error: {res_json.get('error')}")
        except Exception as e:
            logger.error(f"Failed to send Slack Web API notification: {e}")
            self._record_notification(channel.id, "slack", alert, "failed", str(e))

    async def _send_agentmail_notification(self, channel: NotificationChannel, alert: Dict[str, Any]) -> None:
        """Send notification via AgentMail API."""
        api_key = settings.AGENTMAIL_API_KEY
        inbox = settings.AGENTMAIL_INBOX
        
        if not api_key or not channel.email_addresses:
            return

        try:
            severity = alert.get('severity', 'medium').upper()
            subject = f"🚨 Oddjob Alert [{severity}]: {alert.get('title')}"
            html_body = self._create_email_html(alert)
            
            payload = {
                "to": channel.email_addresses,
                "subject": subject,
                "html": html_body,
                "text": f"{subject}\n\n{alert.get('description')}\n\nReason: {alert.get('reason')}"
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            url = f"https://api.agentmail.to/v0/inboxes/{inbox}/messages/send"
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as response:
                    if response.status >= 200 and response.status < 300:
                        self._record_notification(channel.id, "agentmail", alert, "success")
                        logger.info(f"AgentMail alert sent to {len(channel.email_addresses)} recipients")
                    else:
                        response_text = await response.text()
                        raise Exception(f"AgentMail API error {response.status}: {response_text}")
        except Exception as e:
            logger.error(f"Failed to send AgentMail notification: {e}")
            self._record_notification(channel.id, "agentmail", alert, "failed", str(e))

    def _create_email_html(self, alert: Dict[str, Any]) -> str:
        """Create HTML email body for alert."""
        severity_colors = {
            "low": "#28a745",
            "medium": "#ffc107",
            "high": "#fd7e14",
            "critical": "#dc3545"
        }

        color = severity_colors.get(alert.get('severity', 'medium'), "#6c757d")

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }}
                .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }}
                .header {{ background: {color}; color: white; padding: 15px; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px; }}
                .severity {{ display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }}
                .details {{ background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }}
                .footer {{ margin-top: 20px; padding-top: 15px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>🚨 Oddjob Alert</h2>
                    <span class="severity" style="background: rgba(255,255,255,0.2);">{alert.get('severity', 'medium').upper()}</span>
                </div>

                <h3>{alert.get('title', 'Alert')}</h3>
                <p><strong>Description:</strong> {alert.get('description', 'N/A')}</p>
                <p><strong>Reason:</strong> {alert.get('reason', 'N/A')}</p>

                <div class="details">
                    <p><strong>Alert ID:</strong> {alert.get('id', 'N/A')}</p>
                    <p><strong>Category:</strong> {alert.get('category', 'N/A')}</p>
                    <p><strong>Endpoint:</strong> {alert.get('endpoint', 'N/A')}</p>
                    <p><strong>User ID:</strong> {alert.get('user_id', 'N/A')}</p>
                    <p><strong>Timestamp:</strong> {alert.get('timestamp', 'N/A')}</p>
                </div>

                <div class="footer">
                    <p>This alert was generated by Oddjob Backend v{settings.VERSION}</p>
                    <p>Please investigate and resolve this issue promptly.</p>
                </div>
            </div>
        </body>
        </html>
        """

        return html

    def _record_notification(self, channel_id: str, notification_type: str, alert: Dict[str, Any],
                           status: str, error_message: Optional[str] = None) -> None:
        """Record notification attempt."""
        notification_record = {
            "timestamp": datetime.now(timezone.utc),
            "channel_id": channel_id,
            "notification_type": notification_type,
            "alert_id": alert.get('id'),
            "status": status,
            "error_message": error_message
        }

        self.notification_history.append(notification_record)

        # Maintain history size
        if len(self.notification_history) > self.max_history:
            self.notification_history = self.notification_history[-self.max_history:]

    def get_notification_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent notification history."""
        return self.notification_history[-limit:]

    async def test_channel(self, channel_id: str) -> Dict[str, Any]:
        """Test a notification channel with a test alert."""
        if channel_id not in self.channels:
            return {"success": False, "error": "Channel not found"}

        channel = self.channels[channel_id]

        # Create test alert
        test_alert = {
            "id": "test_alert",
            "title": "Test Alert - Notification System",
            "description": "This is a test notification to verify the channel is working correctly.",
            "severity": "low",
            "category": "system",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": "Manual test of notification channel"
        }

        try:
            if channel.type == "email":
                await self._send_email_notification(channel, test_alert)
            elif channel.type == "webhook":
                await self._send_webhook_notification(channel, test_alert)

            return {"success": True, "message": f"Test notification sent via {channel.type}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def verify_agentmail_signature(self, body: bytes, svix_id: str, svix_timestamp: str, svix_signature: str) -> bool:
        """Verify AgentMail webhook signature (HMAC-SHA256)."""
        secret = settings.AGENTMAIL_WEBHOOK_SECRET
        if not secret:
            logger.warning("AGENTMAIL_WEBHOOK_SECRET not configured, skipping verification")
            return False
            
        try:
            # Strip 'whsec_' prefix and decode
            secret_key = base64.b64decode(secret.replace("whsec_", ""))
            to_sign = f"{svix_id}.{svix_timestamp}.{body.decode('utf-8')}".encode('utf-8')
            
            # Compute signature
            computed = hmac.new(secret_key, to_sign, hashlib.sha256).digest()
            computed_b64 = base64.b64encode(computed).decode('utf-8')
            
            # Strip 'v1,' from signature if present
            incoming = svix_signature.replace("v1,", "")
            
            return hmac.compare_digest(computed_b64, incoming)
        except Exception as e:
            logger.error(f"HMAC verification error: {e}")
            return False


# Global notification manager instance
notification_manager = NotificationManager()