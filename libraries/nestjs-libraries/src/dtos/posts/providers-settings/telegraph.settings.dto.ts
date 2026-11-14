import {
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class TelegraphSettingsDto {
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  // Optional backlink appended to the page as "Originally published at …".
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\/\S+$/, { message: 'Invalid URL' })
  backlinkUrl?: string;
}
