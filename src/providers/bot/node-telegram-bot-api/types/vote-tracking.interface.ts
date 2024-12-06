export interface VoteParticipant {
  id: number;
  username: string;
  first_name?: string;
  answer: number;
  timestamp: number;
}

export interface DailyVote {
  pollId: number;
  messageId: number;
  participants: VoteParticipant[];
  startTime: number;
  needsFollowUp: VoteParticipant[];
}
