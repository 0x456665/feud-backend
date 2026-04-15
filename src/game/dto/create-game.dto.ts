import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';

/** Inline option at game-creation time — just the display text. */
export class CreateOptionInlineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  option_text!: string;
}

/** Inline question submitted as part of game creation. */
export class CreateQuestionInlineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;

  /**
   * Options are plain strings at creation time.
   * Votes/points/rank are all null until the survey phase closes.
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options!: string[];
}

/**
 * DTO for creating a new game with all its questions and options in one request.
 *
 * The admin receives `game_code` and `admin_code` in the response.
 * The raw `admin_code` is shown ONCE and must be saved — it cannot be recovered.
 */
export class CreateGameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  game_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  team_a_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  team_b_name?: string;

  /**
   * Number of questions to play per game session.
   * Must not exceed the number of questions provided.
   */
  @IsInt()
  @Min(1)
  @Max(20)
  num_rounds!: number;

  /**
   * Initial set of questions.  You can add more later via the
   * POST /admin/games/:gameCode/questions endpoint or bulk import.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionInlineDto)
  questions!: CreateQuestionInlineDto[];
}
