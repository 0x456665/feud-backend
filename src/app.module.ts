import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      ssl: process.env.DB_SSL === 'true',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      autoLoadEntities: true,
      migrationsRun: true,
      migrations: [__dirname + '/../migrations/**/*{.ts,.js}'],
      synchronize: process.env.TYPEORM_SYNC === 'true',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
