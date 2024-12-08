import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { GameSession } from './entities/game-session.entity';

@Injectable()
export class DatabaseService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(GameSession)
    private gameSessionsRepository: Repository<GameSession>,
  ) {}

  async updateUserStats(
    userData: { id: number; username: string; first_name: string },
    isPositiveVote: boolean,
  ) {
    const user = await this.usersRepository.findOne({
      where: { id: userData.id },
    });

    if (user) {
      user.total_votes += 1;
      if (isPositiveVote) user.positive_votes += 1;
      user.participation_rate = (user.positive_votes / user.total_votes) * 100;
      user.last_vote_date = new Date();
      return this.usersRepository.save(user);
    }

    return this.usersRepository.save({
      ...userData,
      total_votes: 1,
      positive_votes: isPositiveVote ? 1 : 0,
      participation_rate: isPositiveVote ? 100 : 0,
      last_vote_date: new Date(),
    });
  }

  async getUserStats(userId: number) {
    return this.usersRepository.findOne({ where: { id: userId } });
  }

  async getTopPlayers(limit: number = 5) {
    return this.usersRepository.find({
      order: {
        total_votes: 'DESC',
        positive_votes: 'DESC',
      },
      take: limit,
    });
  }

  async createGameSession(date: Date) {
    return this.gameSessionsRepository.save({
      date,
      status: 'pending',
    });
  }

  async updateGameSession(id: number, data: Partial<GameSession>) {
    await this.gameSessionsRepository.update(id, data);
    return this.gameSessionsRepository.findOne({ where: { id } });
  }

  async getRecentGameSessions(limit: number = 5) {
    return this.gameSessionsRepository.find({
      order: {
        date: 'DESC',
      },
      take: limit,
    });
  }

  async getGameStats() {
    const totalGames = await this.gameSessionsRepository.count();
    const confirmedGames = await this.gameSessionsRepository.count({
      where: { status: 'confirmed' },
    });

    return {
      totalGames,
      confirmedGames,
      successRate: totalGames ? (confirmedGames / totalGames) * 100 : 0,
    };
  }
}
