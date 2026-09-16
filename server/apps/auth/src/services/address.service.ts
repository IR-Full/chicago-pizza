import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@chicago-pizza/prisma';
import { CreateAddressDto, UpdateAddressDto } from '../dto/address.dto';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
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
    await this.assertOwnership(userId, addressId);
    await this.prisma.address.delete({ where: { id: addressId } });
    return { success: true };
  }

  private async assertOwnership(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) throw new NotFoundException('Address not found');
  }

  private clearDefault(userId: string) {
    return this.prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }
}
