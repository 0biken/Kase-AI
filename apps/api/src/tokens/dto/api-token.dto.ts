import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ROLES } from '../../auth/roles';

export class CreateApiTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(ROLES)
  role!: (typeof ROLES)[number];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
