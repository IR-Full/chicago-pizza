import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductType } from '@chicago-pizza/prisma';

/** Query strings arrive as "true"/"false"; coerce them before validation. */
const toBoolean = () =>
  Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  });

export class ProductQueryDto {
  @ApiPropertyOptional({ example: 'pizza' })
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional({ description: 'Поиск по названию и ингредиентам' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isSpicy?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isNew?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class PizzaConfigBodyDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'Вторая половинка для пиццы 50/50' })
  @IsOptional()
  @IsUUID()
  secondHalfProductId?: string;

  @ApiPropertyOptional({ enum: [30, 45, 60] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sizeCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doughTypeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsUUID(undefined, { each: true })
  addedIngredientIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsUUID(undefined, { each: true })
  removedIngredientIds?: string[];
}

export class PriceItemBodyDto {
  // @ValidateNested is required, not optional polish: without it the
  // whitelisting ValidationPipe treats `config` as an unknown property and
  // rejects the request outright.
  // @ValidateNested alone does not reject an absent value — @IsDefined does.
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

/** Home-page reviews strip. Bounded here as well as in the orders service. */
export class RecentReviewsQueryDto {
  @ApiPropertyOptional({ default: 3, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 3;
}
