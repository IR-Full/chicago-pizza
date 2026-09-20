import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TicketChannel } from '@chicago-pizza/prisma';

export class CreateTicketDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ enum: TicketChannel, default: TicketChannel.TICKET })
  @IsOptional()
  @IsEnum(TicketChannel)
  channel?: TicketChannel;
}

export class AddTicketMessageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

/**
 * The two keys a Web Push subscription carries. They are what the browser
 * hands out for encrypting a push payload, so they are opaque strings to us —
 * but they still have to be *declared*, which is the whole point here.
 */
export class PushKeysDto {
  @ApiProperty({ description: 'Публичный ключ подписки (P-256 ECDH)' })
  @IsString()
  @Length(1, 255)
  p256dh!: string;

  @ApiProperty({ description: 'Секрет аутентификации подписки' })
  @IsString()
  @Length(1, 255)
  auth!: string;
}

export class SubscribePushDto {
  @ApiProperty()
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;

  /**
   * `keys` used to be declared with `@ApiProperty` alone and no validator.
   * `ValidationPipe({ whitelist: true })` strips every property it has no
   * decorator for, so the field was deleted from the body on its way in and
   * the insert then failed against a NOT NULL column — a 500 on every call.
   * Swagger metadata is documentation; only a validator makes a field real.
   */
  @ApiProperty({ type: PushKeysDto })
  // `@ValidateNested` alone passes an absent value — it validates what is
  // there, and nothing is there. Without `@IsDefined` a body with no `keys`
  // still reached the insert and failed against a NOT NULL column.
  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}
