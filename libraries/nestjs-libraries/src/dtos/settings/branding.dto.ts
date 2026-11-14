import { IsOptional, IsString, MaxLength } from 'class-validator';

export class BrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string | null;

  /** Hex colour, validated for real in BrandingService (#RRGGBB). */
  @IsOptional()
  @IsString()
  @MaxLength(7)
  accentColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  portalName?: string | null;
}
