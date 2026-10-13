'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteAddress } from '@/entities/user/queries';
import type { Address } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/shared/ui/dialog';

export function DeleteAddressButton({ address }: { address: Address }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const remove = useDeleteAddress();
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    try {
      await remove.mutateAsync(address.id);
      setOpen(false);
      toast.success(t('addressDeleted'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('addressDeleteFailed'));
    } finally {
      pending.current = false;
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={t('deleteAddress', { title: address.title })}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending.current) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('deleteAddress', { title: address.title })}</DialogTitle>
          <DialogDescription>
            {address.city}, {address.street}, {address.house}
            {address.apartment ? `, ${address.apartment}` : ''}. {t('addressDeleteHint')}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={remove.isPending}>
              {tc('cancel')}
            </Button>
            <Button onClick={confirm} loading={remove.isPending}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
