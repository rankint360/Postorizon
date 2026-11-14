import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SampleEngagementDto {
  /** How many days back to look for published posts (default 30). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  /** Max posts to sample in one run (default 50). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
