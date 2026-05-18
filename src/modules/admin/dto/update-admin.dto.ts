import { IsString, IsOptional, Length } from 'class-validator';

export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  permissions?: string; // Space-separated codes: "1 3 5 7 x"
}
