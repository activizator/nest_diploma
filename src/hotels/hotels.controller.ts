import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  Put,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { HotelsService } from './hotels.service';
import type { Types } from 'mongoose';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { HotelRoomService } from './hotel.room.service';

// Ограничения
// Если пользователь не аутентифицирован или его роль client, то при поиске всегда должен использоваться флаг isEnabled: true.

const imageFileFilter = (req, file, callback) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    callback(new Error('Only image files are allowed!'), false);
  }
  callback(null, true);
};

const editFileName = (req, file, callback) => {
  const name = file.originalname.split('.')[0];
  const fileExtName = extname(file.originalname);
  const randomName = Array(4)
    .fill(null)
    .map(() => Math.round(Math.random() * 16).toString(16))
    .join('');
  callback(null, `${name}-${randomName}${fileExtName}`);
};

@Controller('/api/')
export class HotelsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly hotelRoomService: HotelRoomService,
  ) {}

  @Get('/common/hotel-rooms')
  async getAllRooms(
    @Query('hotel') hotel?: Types.ObjectId,
    @Query('limit') limit?,
    @Query('offset') offset?,
  ) {
    limit = limit ? parseInt(limit) : 100;
    offset = offset ? parseInt(offset) : 0;
    const isEnabled = true;
    return await this.hotelRoomService.search({
      hotel,
      limit,
      offset,
      isEnabled,
    });
  }

  @Get('/common/hotel-rooms/:id')
  async getTheRoom(@Param() params) {
    return await this.hotelRoomService.findById(params.id);
  }

  @Post('/admin/hotels/')
  //   Доступ
  // Доступно только аутентифицированным пользователям с ролью admin.

  // Ошибки
  // 401 - если пользователь не аутентифицирован
  // 403 - если роль пользователя не admin
  async addTheHotel(@Body() body: { title: string; description: string }) {
    const { title, description } = body;
    return await this.hotelsService.create({ title, description });
  }

  @Get('/admin/hotels/')
  //   Доступ
  // Доступно только аутентифицированным пользователям с ролью admin.

  // Ошибки
  // 401 - если пользователь не аутентифицирован
  // 403 - если роль пользователя не admin
  async findAllHotels(@Query('limit') limit?, @Query('offset') offset?) {
    limit = limit ? parseInt(limit) : 100;
    offset = offset ? parseInt(offset) : 0;
    return await this.hotelsService.search({ limit, offset });
  }

  @Put('/admin/hotels/:id')
  //   Доступ
  // Доступно только аутентифицированным пользователям с ролью admin.

  // Ошибки
  // 401 - если пользователь не аутентифицирован
  // 403 - если роль пользователя не admin
  async changeTheHotelDesc(
    @Param() params,
    @Body() hotel: { title: string; description: string },
  ) {
    const id = params.id;
    return await this.hotelsService.update({ id, hotel });
  }

  @Post('/admin/hotel-rooms/')
  @UseInterceptors(
    FilesInterceptor('images', 20, {
      storage: diskStorage({
        destination: './rooms-imgs',
        filename: editFileName,
      }),
      fileFilter: imageFileFilter,
    }),
  )
  async addNewRoom(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body,
  ) {
    const { title, description, hotelId } = body;
    const images = files.map((file) => file.path);
    const isEnabled = true; // Если пользователь не аутентифицирован или его роль client, то при поиске всегда должен использоваться флаг isEnabled: true.
    const hotel = hotelId;
    return await this.hotelRoomService.create({
      title,
      description,
      hotel,
      images,
      isEnabled,
    });
  }

  @Put('/admin/hotel-rooms/:id')
  @UseInterceptors(
    FilesInterceptor('images', 20, {
      storage: diskStorage({
        destination: './rooms-imgs',
        filename: editFileName,
      }),
      fileFilter: imageFileFilter,
    }),
  )
  async editRoom(
    @Param() params,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body,
  ) {
    const isEnabled = true; // Если пользователь не аутентифицирован или его роль client, то при поиске всегда должен использоваться флаг isEnabled: true.
    const images = [];
    const im = body.images;
    Array.isArray(im) ? im.map((file) => images.push(file)) : images.push(im);
    files.map((file) => images.push(file.path));
    const id = params.id;
    const { title, description, hotelId } = body;
    const hotel = hotelId;
    return await this.hotelRoomService.update({
      id,
      title,
      description,
      hotel,
      images,
      isEnabled,
    });
  }
}
