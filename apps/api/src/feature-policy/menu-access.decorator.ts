import { SetMetadata } from '@nestjs/common';

export type MenuAccessMode = 'read' | 'write';
export type MenuAccessRequirement = {
  code: string;
  mode: MenuAccessMode;
};

export const MENU_ACCESS_KEY = 'lifehome:menu-access';
export const MenuAccess = (
  code: string,
  mode: MenuAccessMode = 'read',
): MethodDecorator & ClassDecorator =>
  SetMetadata(MENU_ACCESS_KEY, { code, mode } satisfies MenuAccessRequirement);
