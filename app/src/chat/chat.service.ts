import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { mongoose, ReturnModelType } from '@typegoose/typegoose';
import { InjectModel } from 'nestjs-typegoose';
import { MessageModel, SupportRequestModel } from './chat.model';
import { UsersService } from 'src/users/users.service';
import { Subject } from 'rxjs';

@Injectable()
export class ChatService {
  private messagesSubject = new Subject<{requestId: string, message:any}>();
  constructor(
    @InjectModel(MessageModel)
    private readonly messageModel: ReturnModelType<typeof MessageModel>,
    @InjectModel(SupportRequestModel)
    private readonly supportRequestModel: ReturnModelType<typeof SupportRequestModel>,
    private readonly userService: UsersService,
  ) {
  }

  get messages() {
    return this.messagesSubject.asObservable();
  }
  async createSupportRequest({ id, text }) {
    const ObjectId = mongoose.Types.ObjectId;
    const createdMessage = new this.messageModel({
      author: id,
      text,
      sentAt: new Date(),
      readAt: undefined,
    });
    const answer = await createdMessage.save();
    const messages = [{ id: answer._id, text }];
    const answerReq = await this.supportRequestModel.findOneAndUpdate(
      { _id: ObjectId(answer._id) },
      {
        user: id,
        $addToSet: { messages },
        isActive: true,
      },
      { upsert: true, new: true, useFindAndModify: false },
    );
    const ans = await this.supportRequestModel.aggregate([
      { $match: { _id: ObjectId(answerReq._id) } },
      { $addFields: { hasNewMessages: false } },
      {
        $project: {
          _id: 0,
          id: '$_id',
          createdAt: 1,
          isActive: 1,
          hasNewMessages: 1,
        },
      },
    ]);
    return ans;
  }

  async sendMessage({ id, userId, text }) {
    try {
      const ObjectId = mongoose.Types.ObjectId;
      const createdMessage = new this.messageModel({
        author: userId,
        text,
        sentAt: new Date(),
        readAt: undefined,
      });
      const answer = await createdMessage.save();
      const u = await this.userService.findById(userId);
      const userName = u.name;
      const messages = [{ id: answer._id, text }];
      await this.supportRequestModel.findOneAndUpdate(
        { _id: ObjectId(id) },
        {
          $addToSet: { messages },
          isActive: true,
        },
        { upsert: true, new: true, useFindAndModify: false },
      );
      let resultMessage = {
        id: answer._id,
        createdAt: answer.sentAt,
        text: answer.text,
        readAt: answer.readAt,
        author: {
          id: answer.author,
          name: userName,
        },
      };
      this.messagesSubject.next({
        requestId: ObjectId(id).toString(),
        message: resultMessage
      })
      return [
        resultMessage,
      ];
    } catch(err) {
      console.error(err);
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Запрос в службу поддержки с данным id отсутствует',
        },
        400,
      );
    }
  }

  async findSupportRequests({ userId, isActive, limit, offset }) {
    const role = userId === 'forManagerAny' ? 'manager' : 'client';

    if (role === 'manager') {
      return this.findManagerSupportRequests(isActive, offset, limit);
    } else {
      return this.findClientSupportRequests(userId, isActive, offset, limit);
    }
  }

  async hasNewMessages({ userId }) {
    const uId = userId ? userId : { $exists: true };
    const mess = await this.messageModel
      .findOne({ readAt: { $exists: false }, author: uId })
      .exec();
    return !!mess.id;
  }

  private async findClientSupportRequests(userId, isActive, offset, limit) {
    const hasNewMessages = await this.hasNewMessages({ userId });
    const project = {
      _id: 0,
      id: '$_id',
      createdAt: 1,
      isActive: 1,
      hasNewMessages: 1,
    };
    return await this.supportRequestModel
      .aggregate([
        {
          $match: {
            user: mongoose.Types.ObjectId(userId),
            isActive,
          },
        },
        { $addFields: { hasNewMessages } },
        {
          $project: project,
        },
      ])
      .skip(offset)
      .limit(limit)
      .exec();
  }

  private async findManagerSupportRequests(isActive, offset, limit) {
    const hasNewMessages = await this.hasNewMessages({ userId: undefined });
    const project = {
      _id: 0,
      id: '$_id',
      createdAt: 1,
      isActive: 1,
      hasNewMessages: 1,
      client: {
        id: '$user._id',
        name: '$user.name',
        email: '$user.email',
        contactPhone: '$user.contactPhone',
      },
    };
    return await this.supportRequestModel
      .aggregate([
        {
          $match: {
            user: { $exists: true },
            isActive,
          },
        },
        {
          $lookup: {
            localField: 'user',
            from: 'User',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: {
            path: '$user',
          },
        },
        { $addFields: { hasNewMessages } },
        {
          $project: project,
        },
      ])
      .skip(offset)
      .limit(limit)
      .exec();
  }

  async getMessages({ id, isActive, limit, offset, user }) {
    const ObjectId = mongoose.Types.ObjectId;
    try {
      const answer = await this.supportRequestModel
        .find({
          _id: ObjectId(id),
          isActive,
        })
        .skip(offset)
        .limit(limit)
        .exec();
      if (
        user.role == 'client' &&
        ObjectId(answer[0].user).toString() !== ObjectId(user.id).toString()
      ) {
        throw new HttpException(
          {
            status: HttpStatus.NOT_FOUND,
            error:
              'Запрос в службу поддержки с данным id отсутствует для данного пользователя',
          },
          400,
        );
      }
      let messages = answer[0].messages;
      messages = messages.map((mess) => mess.id);
      const ans = await this.messageModel.aggregate([
        {
          $match: {
            _id: { $in: messages },
            readAt: { $exists: false },
          },
        },
        {
          $lookup: {
            localField: 'author',
            from: 'User',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: {
            path: '$user',
          },
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            createdAt: '$sentAt',
            text: 1,
            readAt: 1,
            author: {
              id: '$user._id',
              name: '$user.name',
            },
          },
        },
      ]);
      return ans;
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error:
            'Запрос в службу поддержки с данным id отсутствует для данного пользователя',
        },
        400,
      );
    }
  }

  async markMessagesAsRead({ id, createdBefore }) {
    const ObjectId = mongoose.Types.ObjectId;
    try {
      const answer = await this.supportRequestModel
        .find({
          _id: ObjectId(id),
        })
        .exec();
      let messages = answer[0].messages;
      messages = messages.map((mess) => mess.id);
      await this.messageModel.updateMany(
        {
          _id: { $in: messages },
          readAt: { $exists: false },
        },
        { readAt: createdBefore },
      );
      return {
        success: true,
      };
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error:
            'Запрос в службу поддержки с данным id отсутствует для данного пользователя',
        },
        400,
      );
    }
  }
}
