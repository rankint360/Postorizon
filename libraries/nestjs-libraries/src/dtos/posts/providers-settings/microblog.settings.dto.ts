import { IsOptional, IsString, MinLength } from 'class-validator';

export class MicroblogSettingsDto {
  // Optional: Micro.blog treats a post with a title as a long-form post.
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;
}
