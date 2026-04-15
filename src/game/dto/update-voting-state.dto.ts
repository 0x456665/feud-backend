import { IsEnum } from 'class-validator';
import { VotingState } from '../../common/enums/game.enums';

/**
 * DTO for the admin PATCH /admin/games/:gameCode/voting endpoint.
 * Transitions the game's survey/voting phase.
 */
export class UpdateVotingStateDto {
  @IsEnum(VotingState, {
    message: `voting_state must be one of: ${Object.values(VotingState).join(', ')}`,
  })
  voting_state!: VotingState;
}
