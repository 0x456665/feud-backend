import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllTablesSetup1776240475844 implements MigrationInterface {
  name = 'AllTablesSetup1776240475844';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "options" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "question_id" uuid NOT NULL, "option_text" character varying(200) NOT NULL, "votes" integer NOT NULL DEFAULT '0', "rank" integer, "points" integer, CONSTRAINT "PK_d232045bdb5c14d932fba18d957" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2bdd03245b8cb040130fe16f21" ON "options" ("question_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."gameplays_team_win_enum" AS ENUM('TEAM_A', 'TEAM_B', 'NONE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "gameplays" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "question_id" uuid NOT NULL, "team_win" "public"."gameplays_team_win_enum", "point_won" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2077bdff17e81a9cb9f09afe559" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0735d95f0b54e2b73f8f395949" ON "gameplays" ("game_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "question" text NOT NULL, "number_of_options" integer NOT NULL DEFAULT '6', "std_dev" double precision, "display_order" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_08a6d4b0f49ff300bf3a0ca60ac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2fd6ddf4cb199ba01ee26ec1eb" ON "questions" ("game_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gameplay_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "team_a_score" integer NOT NULL DEFAULT '0', "team_b_score" integer NOT NULL DEFAULT '0', "current_question_id" uuid, "options_revealed" jsonb NOT NULL DEFAULT '[]', "questions_completed" jsonb NOT NULL DEFAULT '[]', "current_strikes" integer NOT NULL DEFAULT '0', "state_snapshot" jsonb, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7651997c86432e9e025d0188b13" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_61dcd74faa0b22cf1781b47efe" ON "gameplay_logs" ("game_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_wins_winning_team_enum" AS ENUM('TEAM_A', 'TEAM_B', 'NONE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_wins" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "winning_team" "public"."game_wins_winning_team_enum" NOT NULL, "team_a_total" integer NOT NULL DEFAULT '0', "team_b_total" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_736d305859be19801656c8a6730" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fe43f7bcac6e5888400c8ad48c" ON "game_wins" ("game_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."games_voting_state_enum" AS ENUM('OPEN', 'PAUSED', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."games_play_state_enum" AS ENUM('LOBBY', 'IN_PROGRESS', 'PAUSED', 'FINISHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "games" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_name" character varying(100) NOT NULL, "game_code" character varying(6) NOT NULL, "admin_code" character varying NOT NULL, "team_a_name" character varying(50) NOT NULL DEFAULT 'Team A', "team_b_name" character varying(50) NOT NULL DEFAULT 'Team B', "num_rounds" integer NOT NULL, "voting_state" "public"."games_voting_state_enum" NOT NULL DEFAULT 'OPEN', "play_state" "public"."games_play_state_enum" NOT NULL DEFAULT 'LOBBY', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c9b16b62917b5595af982d66337" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_12e01996eff448b053767c74cc" ON "games" ("game_code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "voters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "question_id" uuid NOT NULL, "cookie_token" uuid NOT NULL, "device_fingerprint" character varying(64) NOT NULL, "user_agent" character varying(500) NOT NULL, "ip_address" character varying(45) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_67fb9dbb4b6fb6ac9980e84af1d" UNIQUE ("game_id", "question_id", "cookie_token"), CONSTRAINT "PK_a58842a42a7c48bc3efebb0a305" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5dc69580e1f713a06f9a01b13" ON "voters" ("game_id", "question_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "player_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "game_id" uuid NOT NULL, "device_fingerprint" character varying(64) NOT NULL, "ip_address" character varying(45) NOT NULL, "user_agent" character varying(500) NOT NULL, "cookie_token" uuid, "joined_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3ef876b3c1f95a057a08256dfbf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e86744271e6d2fe63f9bc273c1" ON "player_sessions" ("game_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "options" ADD CONSTRAINT "FK_2bdd03245b8cb040130fe16f21d" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplays" ADD CONSTRAINT "FK_0735d95f0b54e2b73f8f395949c" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplays" ADD CONSTRAINT "FK_d1255de18990e99803cefe82c98" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ADD CONSTRAINT "FK_2fd6ddf4cb199ba01ee26ec1eb6" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplay_logs" ADD CONSTRAINT "FK_61dcd74faa0b22cf1781b47efe9" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplay_logs" ADD CONSTRAINT "FK_2127b8a3ec7f74a9b95976d0a84" FOREIGN KEY ("current_question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_wins" ADD CONSTRAINT "FK_fe43f7bcac6e5888400c8ad48c4" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "voters" ADD CONSTRAINT "FK_f9de06f4659cb3543aa0f87937d" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "voters" ADD CONSTRAINT "FK_2865c0832e8bfe732f3fffb4b0c" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_sessions" ADD CONSTRAINT "FK_e86744271e6d2fe63f9bc273c16" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_sessions" DROP CONSTRAINT "FK_e86744271e6d2fe63f9bc273c16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "voters" DROP CONSTRAINT "FK_2865c0832e8bfe732f3fffb4b0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "voters" DROP CONSTRAINT "FK_f9de06f4659cb3543aa0f87937d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_wins" DROP CONSTRAINT "FK_fe43f7bcac6e5888400c8ad48c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplay_logs" DROP CONSTRAINT "FK_2127b8a3ec7f74a9b95976d0a84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplay_logs" DROP CONSTRAINT "FK_61dcd74faa0b22cf1781b47efe9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" DROP CONSTRAINT "FK_2fd6ddf4cb199ba01ee26ec1eb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplays" DROP CONSTRAINT "FK_d1255de18990e99803cefe82c98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gameplays" DROP CONSTRAINT "FK_0735d95f0b54e2b73f8f395949c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "options" DROP CONSTRAINT "FK_2bdd03245b8cb040130fe16f21d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e86744271e6d2fe63f9bc273c1"`,
    );
    await queryRunner.query(`DROP TABLE "player_sessions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a5dc69580e1f713a06f9a01b13"`,
    );
    await queryRunner.query(`DROP TABLE "voters"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12e01996eff448b053767c74cc"`,
    );
    await queryRunner.query(`DROP TABLE "games"`);
    await queryRunner.query(`DROP TYPE "public"."games_play_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."games_voting_state_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe43f7bcac6e5888400c8ad48c"`,
    );
    await queryRunner.query(`DROP TABLE "game_wins"`);
    await queryRunner.query(`DROP TYPE "public"."game_wins_winning_team_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_61dcd74faa0b22cf1781b47efe"`,
    );
    await queryRunner.query(`DROP TABLE "gameplay_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2fd6ddf4cb199ba01ee26ec1eb"`,
    );
    await queryRunner.query(`DROP TABLE "questions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0735d95f0b54e2b73f8f395949"`,
    );
    await queryRunner.query(`DROP TABLE "gameplays"`);
    await queryRunner.query(`DROP TYPE "public"."gameplays_team_win_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2bdd03245b8cb040130fe16f21"`,
    );
    await queryRunner.query(`DROP TABLE "options"`);
  }
}
