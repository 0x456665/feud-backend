import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { TeamSide } from '../../common/enums/game.enums';

/** Body for POST /admin/games/:gameCode/add-score */
export class AddScoreDto {
  @IsEnum(TeamSide, {
    message: `team must be one of: ${Object.values(TeamSide)
      .filter((t) => t !== TeamSide.NONE)
      .join(', ')}`,
  })
  team!: TeamSide.TEAM_A | TeamSide.TEAM_B;

  @IsInt()
  @Min(1)
  points!: number;
}

/** Body for POST /admin/games/:gameCode/reveal-option */
export class RevealOptionDto {
  @IsString()
  optionId!: string;
}

/** Body for POST /admin/games/:gameCode/wrong-answer */
export class WrongAnswerDto {
  @IsEnum(TeamSide, {
    message: `team must be one of: ${Object.values(TeamSide)
      .filter((t) => t !== TeamSide.NONE)
      .join(', ')}`,
  })
  team!: TeamSide.TEAM_A | TeamSide.TEAM_B;
}
