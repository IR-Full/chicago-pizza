import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

export class SubscribePushDto {
  @ApiProperty()
  @IsString()
  endpoint!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  keys!: Record<string, string>;
}
