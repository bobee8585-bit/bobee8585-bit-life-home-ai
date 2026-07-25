import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'lifehome:isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
