#!/usr/bin/env python3
"""Alert the owner without putting SMTP credentials or raw logs in mail/journal."""
import os
from pathlib import Path
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

state = Path(os.environ.get('BACKUP_STATE_DIR', '/var/lib/chicago-backup'))
state.mkdir(mode=0o700, parents=True, exist_ok=True)
now = time.time()
test_alert = os.environ.get('BACKUP_ALERT_TEST') == 'true'
success = state / 'last-success'
last_success = int(success.read_text().strip()) if success.exists() else 0
if not test_alert and os.environ.get('BACKUP_ALERT_FORCE') != 'true' and now - last_success < 7200:
    raise SystemExit(0)
sent = state / 'last-alert'
if not test_alert and sent.exists() and now - sent.stat().st_mtime < 21600:
    raise SystemExit(0)

mail = EmailMessage()
mail['From'] = os.environ['SMTP_FROM']
mail['To'] = os.environ['BACKUP_ALERT_EMAIL']
mail['Date'] = formatdate(localtime=False, usegmt=True)
mail['Message-ID'] = make_msgid(domain=parseaddr(os.environ['SMTP_FROM'])[1].rsplit('@', 1)[-1])
mail['Subject'] = ('Chicago Pizza: проверка оповещений резервного копирования' if test_alert
                   else 'Chicago Pizza: проверьте резервное копирование')
body = ('Свежая внешняя резервная копия не подтверждена либо задание завершилось ошибкой. '
                 'В Dokploy откройте сервис chicago-backups: вкладки Containers и Logs. '
                 'Если установлен вариант systemd, проверьте systemctl status chicago-backup.service '
                 'и journalctl -u chicago-backup.service. '
                 'Проверьте доступность Object Storage, квоту и свободное место. '
                 'Это сообщение не содержит паролей или данных заказов.')
mail.set_content('Это тестовое письмо. Оповещения резервного копирования работают. Ошибки не обнаружены этим тестом.'
                 if test_alert else body)
with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT', '2525')), timeout=30) as smtp:
    smtp.starttls(context=ssl.create_default_context())
    smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
    smtp.send_message(mail)
if not test_alert:
    sent.touch(mode=0o600)
print('Backup alert accepted by SMTP')
