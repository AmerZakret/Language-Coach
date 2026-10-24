import { MutationReceiptModule } from '../common/mutation-receipt';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunityController } from './community.controller';
import { CommunityImageStorage } from './community-image.storage';
import { CommunityService } from './community.service';
import { CommunityPost, CommunityPostSchema } from './schemas/community-post.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MutationReceiptModule,
    MongooseModule.forFeature([
      { name: CommunityPost.name, schema: CommunityPostSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityImageStorage],
  exports: [CommunityService, CommunityImageStorage],
})
export class CommunityModule {}
