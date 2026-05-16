import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lesson } from '../src/lessons/schemas/lesson.schema';
import { englishLessons } from '../src/lessons/data/english-lessons';

async function bootstrap() {
  console.log('Initializing application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const lessonModel = app.get<Model<Lesson>>(getModelToken(Lesson.name));
  
  console.log('Deleting existing English lessons from database...');
  await lessonModel.deleteMany({ targetLanguage: 'en' });
  
  console.log('Inserting new high-quality English lessons...');
  await lessonModel.insertMany(englishLessons);
  
  console.log('Successfully updated the database!');
  
  console.log('\n--- Verification: Sample Lessons ---');
  const sample1 = await lessonModel.findOne({ id: 'en_b_1' }).lean();
  console.log(JSON.stringify(sample1, null, 2));
  
  const sample2 = await lessonModel.findOne({ id: 'en_p_10' }).lean();
  console.log(JSON.stringify(sample2, null, 2));
  console.log('------------------------------------\n');
  
  await app.close();
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
