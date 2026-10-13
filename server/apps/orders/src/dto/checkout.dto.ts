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
import { DeliveryType, FulfillmentType, PaymentMethod } from '@chicago-pizza/prisma';

export class CheckoutDto {
  @IsEnum(FulfillmentType)
  fulfillment: FulfillmentType = FulfillmentType.DELIVERY;

  /**
   * Required for a delivery and meaningless for a collection — an order
   * nobody is bringing anywhere has no address to bring it to.
   */
  @ValidateIf((o: CheckoutDto) => o.fulfillment === FulfillmentType.DELIVERY)
  @IsUUID()
  addressId?: string;

  /** Which kitchen to collect from. Chosen by the customer, not by us. */
  @ValidateIf((o: CheckoutDto) => o.fulfillment === FulfillmentType.PICKUP)
  @IsUUID()
  branchId?: string;

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
