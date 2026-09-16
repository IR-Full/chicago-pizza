import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DeliveryType, PaymentMethod } from '@chicago-pizza/prisma';

export class CheckoutDto {
  @IsUUID()
  addressId!: string;

  @IsEnum(DeliveryType)
  deliveryType: DeliveryType = DeliveryType.ASAP;

  @ValidateIf((o: CheckoutDto) => o.deliveryType === DeliveryType.SCHEDULED)
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  promocode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  redeemPoints?: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod = PaymentMethod.CASH_ON_DELIVERY;
}
