"""
Email delivery seam — currently INACTIVE by default.

The Sector Thesis Scout stores its newsletter as a `ThemeRun` and surfaces it
in-app. This module is the single point where real email delivery can later be
switched on without touching any reasoning logic.

Behaviour:
- If SMTP is NOT configured (the default), `send_newsletter` logs and no-ops — no
  email is sent. The newsletter is still stored and readable in-app.
- If `SMTP_HOST` (and the related vars) ARE set in the environment, it sends the
  newsletter to every recipient via stdlib `smtplib` (no extra dependency).

Configuration (see .env.example):
  SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, NEWSLETTER_FROM
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid


def _smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def send_newsletter(to_addresses: list[str], subject: str, body_markdown: str) -> bool:
    """
    Deliver the newsletter to every recipient. Returns True if a send was attempted
    and succeeded, False if the seam is inactive (SMTP unconfigured) or there are no
    recipients. Never raises — delivery must not break the weekly agent run.

    Works identically regardless of how `body_markdown` was produced — AI-drafted
    (Ollama) or the deterministic offline-template fallback are both plain strings
    by the time they reach this function.
    """
    recipients = sorted({addr.strip() for addr in to_addresses if addr and addr.strip()})
    if not recipients:
        print("[INFO] Newsletter stored; no investor recipients to email.")
        return False

    if not _smtp_configured():
        print(
            f"[INFO] Newsletter stored; email seam inactive (SMTP not configured). "
            f"Would have sent '{subject}' to {len(recipients)} investor(s)."
        )
        return False

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("NEWSLETTER_FROM", user or "no-reply@tunisia-invest.local")
    sender_name = os.getenv("NEWSLETTER_FROM_NAME", "TunisIA Invest")

    msg = MIMEText(body_markdown, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender))
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1])

    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            if os.getenv("SMTP_DEBUG"):
                server.set_debuglevel(1)
            server.ehlo()
            server.starttls()
            server.ehlo()
            if user and password:
                server.login(user, password)
            refused = server.sendmail(sender, recipients, msg.as_string())
            if refused:
                print(f"[WARN] Newsletter '{subject}' refused by SMTP server for: {refused}; stored in-app only.")
                return False
        print(f"[OK] Newsletter '{subject}' emailed to {len(recipients)} investor(s): {', '.join(recipients)}.")
        return True
    except Exception as exc:
        print(f"[WARN] Newsletter email send failed ({type(exc).__name__}: {exc}); stored in-app only.")
        return False
