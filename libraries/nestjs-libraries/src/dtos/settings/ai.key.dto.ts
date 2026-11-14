import { IsEnum, IsString, MinLength } from 'class-validator';
import { AiKeyProvider } from '@prisma/client';

export class SaveAiKeyDto {
  @IsEnum(AiKeyProvider)
  provider: AiKeyProvider;

  @IsString()
  @MinLength(8)
  apiKey: string;
}
