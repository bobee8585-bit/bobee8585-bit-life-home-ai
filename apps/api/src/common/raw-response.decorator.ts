import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_METADATA = 'lifehome:raw-response';

export const RawResponse = () =>
  SetMetadata(RAW_RESPONSE_METADATA, true);
