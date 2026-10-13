import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@chicago-pizza/prisma';
import { CreateAddressDto, UpdateAddressDto } from '../dto/address.dto';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) await this.clearDefault(userId);
    return this.prisma.address.create({ data: { ...dto, userId } });
  }

  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    await this.assertOwnership(userId, addressId);
    if (dto.isDefault) await this.clearDefault(userId);
    return this.prisma.address.update({ where: { id: addressId }, data: dto });
  }

  async remove(userId: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const address = await tx.address.findFirst({ where: { id: addressId, userId } });
      if (!address) throw new NotFoundException('Адрес не найден');
      if (address.archivedAt) return { success: true };
      // Order history keeps the address; only the saved-address picker hides it.
      await tx.address.update({
        where: { id: addressId },
        data: { archivedAt: new Date(), isDefault: false },
      });
      if (address.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return { success: true };
    });
  }

  private async assertOwnership(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId, archivedAt: null },
    });
    if (!address) throw new NotFoundException('Address not found');
  }

  private clearDefault(userId: string) {
    return this.prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }
}
