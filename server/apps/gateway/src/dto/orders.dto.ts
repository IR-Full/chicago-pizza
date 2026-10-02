import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import {
  DeliveryType,
  DiscountType,
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
} from '@chicago-pizza/prisma';
import { MAX_LINE_QUANTITY } from '@chicago-pizza/common';
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
  @Max(MAX_LINE_QUANTITY)
  quantity: number = 1;
}

/**
 * One line of a cart that lives in a browser.
 *
 * `lineId` comes from the client, because the client owns the list — it is
 * how the answer is matched back to the row on screen. It is never trusted
 * for anything else: prices are recomputed server-side from `config` alone.
 */
export class GuestCartLineDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  lineId!: string;

  @ApiProperty({ type: PizzaConfigBodyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PizzaConfigBodyDto)
  config!: PizzaConfigBodyDto;

  @ApiProperty({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number = 1;
}

export class GuestCartDto {
  @ApiProperty({ type: [GuestCartLineDto] })
  @IsArray()
  // An unbounded list would let one request price an arbitrary basket; the
  // stored cart is capped at 50 lines, so the guest one is too.
  @ArrayMaxSize(50)
  @IsDefined()
  @ValidateNested({ each: true })
  @Type(() => GuestCartLineDto)
  lines!: GuestCartLineDto[];
}

/**
 * What a payment provider POSTs to the webhook.
 *
 * Only the id is read, and only to decide which payment to re-read over an
 * authenticated call — so this DTO deliberately describes the smallest part of
 * the body. Anything else in there is somebody's claim, not a fact.
 */
export class PaymentNotificationObjectDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  id!: string;
}

export class PaymentNotificationDto {
  @ApiPropertyOptional({ type: PaymentNotificationObjectDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentNotificationObjectDto)
  object?: PaymentNotificationObjectDto;
}

export class UpdateCartItemDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

export class CheckoutBodyDto {
  @ApiProperty({ enum: FulfillmentType, default: FulfillmentType.DELIVERY })
  @IsEnum(FulfillmentType)
  fulfillment: FulfillmentType = FulfillmentType.DELIVERY;

  @ApiPropertyOptional({ description: 'Обязательно при fulfillment=DELIVERY' })
  @ValidateIf((o: CheckoutBodyDto) => o.fulfillment === FulfillmentType.DELIVERY)
  @IsUUID()
  addressId?: string;

  @ApiPropertyOptional({ description: 'Обязательно при fulfillment=PICKUP — откуда забирать' })
  @ValidateIf((o: CheckoutBodyDto) => o.fulfillment === FulfillmentType.PICKUP)
  @IsUUID()
  branchId?: string;

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

  /**
   * Percent for `PERCENT`, kopecks for `FIXED`.
   *
   * The 1..100 ceiling for a percentage is enforced in `PromocodeService`, not
   * here: the bound depends on another field, and `@ValidateIf` conditions the
   * whole property rather than one decorator — expressing it in this class
   * takes a custom constraint to say something the domain can say in a line.
   * The description used to claim "0-100" while only `Min(1)` was enforced, so
   * `PERCENT` with `500` was a valid request.
   */
  @ApiProperty({ description: 'Проценты (1-100) для PERCENT или сумма в копейках для FIXED' })
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

  /**
   * How often one customer may use the code. Null means "as often as they like".
   *
   * The API could not set this at all, so every code created through the panel
   * silently took the schema default of 1 — and a code meant to be reusable,
   * "−5% на все заказы в октябре", worked exactly once per customer with nothing
   * saying why. A column the database has and the API cannot reach is a setting
   * that effectively does not exist.
   */
  @ApiPropertyOptional({ description: 'Сколько раз одному клиенту; null — без ограничения', nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
