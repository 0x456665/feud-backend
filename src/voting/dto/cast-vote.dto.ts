import { Type } from 'class-transformer';
import {
  IsUUID,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';

/**
 * Single question vote submission.
 */
export class VoteSubmissionDto {
  @IsUUID()
  gameId!: string;

  @IsUUID()
  questionId!: string;

  /** Four to six option IDs the voter has chosen for this question. */
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(6)
  @IsUUID('4', { each: true })
  optionIds!: string[];
}

/**
 * DTO for casting one or more votes in a single request.
 */
export class CastVoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VoteSubmissionDto)
  votes!: VoteSubmissionDto[];
}
