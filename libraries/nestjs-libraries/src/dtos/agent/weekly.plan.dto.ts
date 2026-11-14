import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class WeeklyPlanDto {
  @IsString()
  @MinLength(1)
  customerId: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  brief: string;

  /** First day of the plan week (ISO date). Defaults to next Monday. */
  @IsOptional()
  @IsISO8601()
  weekStart?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  postsCount?: number;

  /** Guardrail: maximum posts (incl. already-planned ones) per day. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxPostsPerDay?: number;
}
