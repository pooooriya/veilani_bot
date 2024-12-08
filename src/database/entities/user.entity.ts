import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn()
  id: number;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  first_name: string;

  @Column({ default: 0 })
  total_votes: number;

  @Column({ default: 0 })
  positive_votes: number;

  @Column({ type: 'float', default: 0 })
  participation_rate: number;

  @Column({ nullable: true })
  last_vote_date: Date;

  @CreateDateColumn()
  created_at: Date;
} 