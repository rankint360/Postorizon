import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateInboxItemStateDto {
  @IsOptional()
  @IsBoolean()
  read?: boolean;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;
}

export class InboxReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
