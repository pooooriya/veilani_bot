import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { User } from './entities/user.entity';
import { GameSession } from './entities/game-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, GameSession]),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/veilani.db',
      entities: [User, GameSession],
      synchronize: true,
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {} 