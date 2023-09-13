import { SendVoteRequestDto } from '../../dtos/send-vote.dto';

export interface ITelegramService {
  SendVote: (request: SendVoteRequestDto) => void;
  PinMessage: () => void;
}
