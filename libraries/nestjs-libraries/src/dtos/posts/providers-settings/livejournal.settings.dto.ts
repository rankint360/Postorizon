import { IsOptional, IsString, MinLength } from 'class-validator';

export class LivejournalSettingsDto {
  // LiveJournal calls the post title "subject".
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;
}
