'use client';

import { useTranslations } from 'next-intl';

/** Replacement characters mean the original bytes were lost before storage. */
export function StoredText({
  text,
  kind = 'message',
}: {
  text?: string | null;
  kind?: 'message' | 'subject' | 'name';
}) {
  const t = useTranslations('support');
  if (!text?.includes('\uFFFD')) return <>{text}</>;
  const key = kind === 'subject' ? 'corruptSubject' : kind === 'name' ? 'corruptName' : 'corruptMessage';
  return (
    <span className="break-words" title={t('corruptHint')}>
      {t(key)}
    </span>
  );
}
