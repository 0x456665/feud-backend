import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config(); // Load environment variables from .env file

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  ssl: process.env.DB_SSL === 'true',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/**/*{.ts,.js}'],
  synchronize: process.env.TYPEORM_SYNC === 'true',
});

export default AppDataSource;
