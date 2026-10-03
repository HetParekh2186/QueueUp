import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("queueup.email")


def send_email(to: str, subject: str, body: str) -> None:
    """Send via SMTP when configured; otherwise log (the dev 'console backend')."""
    if not settings.smtp_host:
        log.info("email (console backend)", extra={"ctx": {"to": to, "subject": subject}})
        return
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password or "")
        smtp.send_message(msg)
