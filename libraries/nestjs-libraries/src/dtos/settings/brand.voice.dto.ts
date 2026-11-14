import { IsArray, IsOptional, IsString } from 'class-validator';

export class BrandVoiceDto {
  @IsOptional()
  @IsString()
  toneNotes?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bannedTopics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  examplePostIds?: string[];
}
