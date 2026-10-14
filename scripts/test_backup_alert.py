import os
from pathlib import Path
import runpy
import tempfile
import time
import unittest
from unittest.mock import patch


class BackupAlerts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name)
        self.environment = patch.dict(os.environ, {
            'BACKUP_STATE_DIR': str(self.state), 'SMTP_FROM': 'backup@example.test',
            'BACKUP_ALERT_EMAIL': 'owner@example.test', 'SMTP_HOST': 'smtp.example.test',
            'SMTP_USER': 'test-user', 'SMTP_PASSWORD': 'test-password',
        }, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def invoke(self):
        runpy.run_path(str(Path(__file__).with_name('backup-alert.py')), run_name='__main__')

    @patch('smtplib.SMTP')
    def test_fresh_backup_does_not_send_false_alarm(self, smtp):
        (self.state / 'last-success').write_text(str(int(time.time())))
        with self.assertRaises(SystemExit) as stopped:
            self.invoke()
        self.assertEqual(stopped.exception.code, 0)
        smtp.assert_not_called()

    @patch('smtplib.SMTP')
    def test_stale_backup_sends_once_then_throttles_repeated_alarm(self, smtp):
        self.invoke()
        connection = smtp.return_value.__enter__.return_value
        connection.starttls.assert_called_once()
        connection.send_message.assert_called_once()
        self.assertTrue((self.state / 'last-alert').exists())
        with self.assertRaises(SystemExit):
            self.invoke()
        self.assertEqual(connection.send_message.call_count, 1)

    @patch('smtplib.SMTP')
    def test_test_message_does_not_suppress_the_next_real_failure(self, smtp):
        os.environ['BACKUP_ALERT_TEST'] = 'true'
        self.invoke()
        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertIn('проверка оповещений', str(message['Subject']))
        self.assertFalse((self.state / 'last-alert').exists())

    @patch('smtplib.SMTP')
    def test_delivery_failure_does_not_mark_the_alert_sent(self, smtp):
        smtp.return_value.__enter__.return_value.send_message.side_effect = OSError('relay down')
        with self.assertRaises(OSError):
            self.invoke()
        self.assertFalse((self.state / 'last-alert').exists())


if __name__ == '__main__':
    unittest.main()
