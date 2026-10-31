"""Notification adapters. Email is a no-op unless recipient and SMTP secrets exist."""
from email.message import EmailMessage
import logging
import os
import smtplib

logger = logging.getLogger(__name__)


def send_email_if_configured(recipient, subject, body):
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if not (recipient and host and sender and username and password):
        return {"status": "not_configured"}
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(username, password)
            server.send_message(message)
        return {"status": "sent"}
    except Exception as exc:
        logger.warning("Monitoring email could not be delivered: %s", exc)
        return {"status": "failed"}
