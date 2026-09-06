import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateAuditDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  repositoryId?: string;

  @IsIn(['smoke', 'security', 'full'])
  mode: 'smoke' | 'security' | 'full' = 'smoke';

  /** Legacy M1 input, translated to categories for smoke mode. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i)
  commitSha?: string;

  @IsOptional()
  @IsInt()
  @Min(60_000)
  @Max(60 * 60_000)
  maxWallTimeMs?: number;
}
