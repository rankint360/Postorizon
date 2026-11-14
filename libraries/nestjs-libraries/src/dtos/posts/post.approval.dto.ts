import { IsOptional, IsString } from 'class-validator';

export class PostApprovalActionDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
