import { Equals } from 'class-validator';

export class PrepareReservationDepositDto {
  @Equals(true, {
    message: '예약금 환불 정책에 동의해야 결제를 준비할 수 있습니다.',
  })
  acceptRefundPolicy!: true;
}
