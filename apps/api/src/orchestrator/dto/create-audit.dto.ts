import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAuditDto {
  @IsString()
  @MinLength(1)
  targetId!: string;

  @IsIn(['smoke'])
  mode: 'smoke' = 'smoke';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category: string = 'fixture_health';
}
