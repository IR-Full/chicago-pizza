'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Role } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Pagination } from '@/shared/ui/pagination';
import { Skeleton } from '@/shared/ui/skeleton';
import { adminApi } from '@/features/admin/api';

const ROLES: Role[] = ['USER', 'COURIER', 'SUPPORT', 'ADMIN'];

export default function AdminUsersPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', search, page],
    queryFn: () => adminApi.listUsers(page, search || undefined),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : 'Действие не выполнено');

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => adminApi.setUserRole(userId, role),
    onSuccess: invalidate,
    onError,
  });

  const setBlocked = useMutation({
    mutationFn: ({ userId, isBlocked }: { userId: string; isBlocked: boolean }) =>
      adminApi.setUserBlocked(userId, isBlocked),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder={tc('search')}
        className="max-w-sm"
        aria-label={tc('search')}
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-2">
          {data?.items.map((user) => (
            <Card key={user.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {user.firstName} {user.lastName ?? ''}
                  </p>
                  <p className="text-muted-foreground">{user.email}</p>
                </div>

                <Badge variant="secondary">{user.loyaltyLevel}</Badge>
                {/* A blocked account has all its sessions revoked server-side. */}
                {/* eslint-disable-next-line react/jsx-no-leaked-render */}
                {user.isBlocked ? <Badge variant="destructive">{t('blocked')}</Badge> : null}

                <select
                  value={user.role}
                  onChange={(e) => setRole.mutate({ userId: user.id, role: e.target.value as Role })}
                  className="ml-auto h-9 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={t('role')}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>

                <Button
                  size="sm"
                  variant={user.isBlocked ? 'outline' : 'destructive'}
                  onClick={() => setBlocked.mutate({ userId: user.id, isBlocked: !user.isBlocked })}
                >
                  {user.isBlocked ? t('unblock') : t('block')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}
