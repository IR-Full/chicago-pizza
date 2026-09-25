import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus, ProductType, Role, TicketStatus } from '@chicago-pizza/prisma';
import { PaginationDto } from '@chicago-pizza/common';

/**
 * The admin endpoints used to take their bodies as bare TypeScript types.
 * A `ValidationPipe` has nothing to validate without a class, so the request
 * body went straight into `prisma.create({ data })` — an admin could write any
 * column, and a mistyped role came back as a 500 from the database instead of
 * a 400 from the API.
 */
export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'combo' })
  @IsString()
  @MaxLength(100)
  slug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ProductSizeDto {
  @ApiProperty({ example: 45 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeCm!: number;

  @ApiProperty({ example: '45 см' })
  @IsString()
  @MaxLength(50)
  label!: string;

  @ApiProperty({ description: 'Цена в копейках' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price!: number;
}

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  slug!: string;

  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Цена в копейках для товаров без размеров' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSpicy?: boolean;

  @ApiPropertyOptional({ description: 'Халяль — заявление поставщика, а не вывод из состава' })
  @IsOptional()
  @IsBoolean()
  isHalal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [ProductSizeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes?: ProductSizeDto[];
}

/** Every field optional — this is a patch. */
export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSpicy?: boolean;

  @ApiPropertyOptional({ description: 'Халяль — заявление поставщика, а не вывод из состава' })
  @IsOptional()
  @IsBoolean()
  isHalal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * How long an item stays off the menu.
 *
 * Minutes rather than a timestamp: the kitchen thinks in "until closing" and
 * "for an hour", and a clock the staff have to read and convert is a clock
 * they will get wrong at the end of a shift.
 */
export class StopProductDto {
  @ApiProperty({
    description: 'На сколько минут снять позицию. 0 — вернуть в продажу.',
    minimum: 0,
    maximum: 24 * 60,
    example: 120,
  })
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  minutes!: number;
}

/**
 * A kitchen. Coordinates are required: a branch that cannot be put on a map
 * cannot be told apart from the next one, and delivery zones will be measured
 * from here.
 */
export class CreateBranchDto {
  @ApiProperty({ example: 'Chicago Pizza на Гамзатова' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'gamzatova' })
  @IsString()
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ example: 'Махачкала, пр. Расула Гамзатова, 45' })
  @IsString()
  @MaxLength(250)
  address!: string;

  @ApiProperty({ example: 42.9764 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 47.5024 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: '+7 8722 55-55-55' })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiPropertyOptional({ default: 10, minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  openingHour?: number;

  // Up to 24 so a branch can honestly say it closes at midnight.
  @ApiPropertyOptional({ default: 23, minimum: 1, maximum: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  closingHour?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** Everything about a branch is editable, including whether it is open at all. */
export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @ApiPropertyOptional({ description: 'false — закрыть точку: новые заказы туда не принимаются' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetUserRoleDto {
  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;
}

export class SetUserBlockedDto {
  @ApiProperty()
  @IsBoolean()
  isBlocked!: boolean;
}

/**
 * Paged list filters.
 *
 * These endpoints used to read `@Query('page')` as a raw string and hand
 * `Number(page)` straight to Prisma's `skip`/`take`. `?limit=1000000` then
 * asked Postgres for a million rows on an endpoint any signed-in user can
 * reach, and `?page=abc` turned into `NaN` and a 500. `PaginationDto` already
 * carried the bounds — it just was not being used here.
 */
export class AdminOrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по email, имени или телефону' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminTicketQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
