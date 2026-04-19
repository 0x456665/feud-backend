import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  game_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  team_a_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  team_b_name?: string;
}
