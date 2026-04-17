import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';

/** DTO for adding a single question after game creation. */
export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;

  /**
   * Initial options (plain strings, no votes yet).
   * At least 1 option is required; the standard is 6 for Family Feud.
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options!: string[];

  /**
   * Override the default max options shown on the board (default: 6).
   * Useful for questions where fewer answers make sense.
   */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(15)
  number_of_options?: number;
}

/** DTO for adding a single option to an existing question. */
export class CreateOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  option_text!: string;
}

/** DTO for a single question entry in the bulk import body. */
export class ImportQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options!: string[];

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(15)
  number_of_options?: number;
}

/** DTO for the bulk question import endpoint. */
export class BulkImportQuestionsDto {
  @IsArray()
  @ArrayNotEmpty()
  questions!: ImportQuestionDto[];
}
