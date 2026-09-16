import { NotFoundException } from '@nestjs/common';
import { AddressService } from './address.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma delegate mocks */
function createService() {
  const prisma: Record<string, any> = {
    address: {
      findMany: jest.fn(async () => [{ id: 'addr-1' }]),
      findFirst: jest.fn(async () => ({ id: 'addr-1', userId: 'user-1' })),
      create: jest.fn(async ({ data }: any) => ({ id: 'addr-new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'addr-1', ...data })),
      delete: jest.fn(async () => ({ id: 'addr-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  return { service: new AddressService(prisma as never), prisma };
}

const ADDRESS = { title: 'Дом', street: 'пр. Расула Гамзатова', house: '45', apartment: '12' };

describe('AddressService', () => {
  describe('list', () => {
    it('returns the default address first, then the newest', async () => {
      const { service, prisma } = createService();

      await service.list('user-1');

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });

    it('scopes the query to the caller', async () => {
      const { service, prisma } = createService();

      await service.list('user-2');

      expect(prisma.address.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-2' });
    });
  });

  describe('create', () => {
    it('stamps the owner onto the new row', async () => {
      const { service, prisma } = createService();

      await service.create('user-1', ADDRESS as never);

      expect(prisma.address.create).toHaveBeenCalledWith({ data: { ...ADDRESS, userId: 'user-1' } });
    });

    it('demotes the previous default when the new address claims it', async () => {
      const { service, prisma } = createService();

      await service.create('user-1', { ...ADDRESS, isDefault: true } as never);

      // Two defaults would make checkout pick an arbitrary one.
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true },
        data: { isDefault: false },
      });
    });

    it('leaves the existing default alone for an ordinary address', async () => {
      const { service, prisma } = createService();

      await service.create('user-1', ADDRESS as never);

      expect(prisma.address.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('refuses to touch an address owned by someone else', async () => {
      const { service, prisma } = createService();
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.update('user-2', 'addr-1', { title: 'Взлом' } as never)).rejects.toThrow(NotFoundException);
      expect(prisma.address.update).not.toHaveBeenCalled();
    });

    it('checks ownership by id and user together', async () => {
      const { service, prisma } = createService();

      await service.update('user-1', 'addr-1', { title: 'Работа' } as never);

      expect(prisma.address.findFirst).toHaveBeenCalledWith({ where: { id: 'addr-1', userId: 'user-1' } });
    });

    it('applies the patch', async () => {
      const { service, prisma } = createService();

      await service.update('user-1', 'addr-1', { title: 'Работа' } as never);

      expect(prisma.address.update).toHaveBeenCalledWith({ where: { id: 'addr-1' }, data: { title: 'Работа' } });
    });

    it('demotes the previous default when promoting this one', async () => {
      const { service, prisma } = createService();

      await service.update('user-1', 'addr-1', { isDefault: true } as never);

      expect(prisma.address.updateMany).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('refuses to delete an address owned by someone else', async () => {
      const { service, prisma } = createService();
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-2', 'addr-1')).rejects.toThrow(NotFoundException);
      expect(prisma.address.delete).not.toHaveBeenCalled();
    });

    it('deletes the address and reports success', async () => {
      const { service, prisma } = createService();

      await expect(service.remove('user-1', 'addr-1')).resolves.toEqual({ success: true });
      expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    });
  });
});
