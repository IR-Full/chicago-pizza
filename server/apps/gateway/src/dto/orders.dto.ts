import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DeliveryType, DiscountType, OrderStatus, PaymentMethod } from '@chicago-pizza/prisma';
import { PizzaConfigBodyDto } from './catalog.dto';

export class AddCartItemDto {
  // Without @ValidateNested the whitelisting pipe rejects `config` as an
  // unknown property — see PriceItemBodyDto.
  @ApiProperty({ type: PizzaConfigBodyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PizzaConfigBodyDto)
  config!: PizzaConfigBodyDto;

  @ApiProperty({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number = 1;
}

export class UpdateCartItemDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  quantity!: number;
}

export class CheckoutBodyDto {
  @ApiProperty()
  @IsUUID()
  addressId!: string;

  @ApiProperty({ enum: DeliveryType, default: DeliveryType.ASAP })
  @IsEnum(DeliveryType)
  deliveryType: DeliveryType = DeliveryType.ASAP;

  @ApiPropertyOptional({ description: 'Обязательно при deliveryType=SCHEDULED' })
  @ValidateIf((o: CheckoutBodyDto) => o.deliveryType === DeliveryType.SCHEDULED)
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  promocode?: string;

  @ApiPropertyOptional({ description: 'Сколько баллов лояльности списать (1 балл = 1 ₽)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  redeemPoints?: number;

  @ApiProperty({ enum: PaymentMethod, default: PaymentMethod.CASH_ON_DELIVERY })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod = PaymentMethod.CASH_ON_DELIVERY;
}

export class ApplyPromocodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code!: string;
}

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}

export class CreatePromocodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({ description: 'Проценты (0-100) или сумма в копейках' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountValue!: number;

  @ApiPropertyOptional({ description: 'Минимальная сумма заказа в копейках' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
