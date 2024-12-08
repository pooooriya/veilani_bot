import { Injectable } from '@nestjs/common';
import { Database } from 'sqlite3';
import { join } from 'path';

@Injectable()
export class DatabaseService {
  private db: Database;

  constructor() {
    this.db = new Database(join(process.cwd(), 'data', 'veilani.db'), (err) => {
      if (err) {
        console.error('Database connection failed:', err);
      } else {
        this.initializeTables();
      }
    });
  }

  private initializeTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        total_votes INTEGER DEFAULT 0,
        positive_votes INTEGER DEFAULT 0,
        last_vote_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        start_time TEXT,
        player_count INTEGER,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async updateUserStats(
    user: { id: number; username: string; first_name: string },
    isPositiveVote: boolean,
  ) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        INSERT INTO users (id, username, first_name, total_votes, positive_votes, last_vote_date)
        VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          total_votes = total_votes + 1,
          positive_votes = CASE WHEN ? THEN positive_votes + 1 ELSE positive_votes END,
          last_vote_date = CURRENT_TIMESTAMP
      `,
        [
          user.id,
          user.username,
          user.first_name,
          isPositiveVote ? 1 : 0,
          isPositiveVote,
        ],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        },
      );
    });
  }

  async getUserStats(userId: number) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getTopPlayers(limit: number = 5) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
          username, 
          first_name,
          total_votes,
          positive_votes,
          ROUND(CAST(positive_votes AS FLOAT) / total_votes * 100, 1) as participation_rate
        FROM users 
        ORDER BY total_votes DESC, positive_votes DESC 
        LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        },
      );
    });
  }
}
