export enum MenuState {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
  READ_ONLY = 'READ_ONLY',
  INTAKE_DISABLED = 'INTAKE_DISABLED',
  DISABLED = 'DISABLED',
  MAINTENANCE = 'MAINTENANCE',
}

export enum Platform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  USER_WEB = 'USER_WEB',
  BROKER_WEB = 'BROKER_WEB',
  ADMIN_CMS = 'ADMIN_CMS',
  API = 'API',
}

export enum PropertyStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum PropertyType {
  APARTMENT = 'APARTMENT',
  VILLA = 'VILLA',
  OFFICETEL = 'OFFICETEL',
  DETACHED_HOUSE = 'DETACHED_HOUSE',
  MULTIFAMILY_HOUSE = 'MULTIFAMILY_HOUSE',
  COMMERCIAL = 'COMMERCIAL',
  LAND = 'LAND',
}

export enum PropertyTransactionType {
  SALE = 'SALE',
  JEONSE = 'JEONSE',
  MONTHLY_RENT = 'MONTHLY_RENT',
}

export enum MediaUploadStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum PropertyReportReason {
  FALSE_INFORMATION = 'FALSE_INFORMATION',
  DUPLICATE = 'DUPLICATE',
  UNAVAILABLE = 'UNAVAILABLE',
  FRAUD_SUSPECTED = 'FRAUD_SUSPECTED',
  ILLEGAL_CONTENT = 'ILLEGAL_CONTENT',
  OTHER = 'OTHER',
}

export enum PropertyReportStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum VisitReservationStatus {
  REQUESTED = 'REQUESTED',
  ALTERNATIVE_PROPOSED = 'ALTERNATIVE_PROPOSED',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  ALTERNATIVE_DECLINED = 'ALTERNATIVE_DECLINED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum VisitReservationAction {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ALTERNATIVE_PROPOSED = 'ALTERNATIVE_PROPOSED',
  ALTERNATIVE_ACCEPTED = 'ALTERNATIVE_ACCEPTED',
  ALTERNATIVE_DECLINED = 'ALTERNATIVE_DECLINED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum ReservationDepositStatus {
  READY = 'READY',
  PAID = 'PAID',
  REFUND_PENDING = 'REFUND_PENDING',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface ReservationDeposit {
  id: string;
  paymentNumber: string;
  reservationId: string;
  amount: string;
  currency: string;
  status: ReservationDepositStatus;
  policyVersion: string;
  refundedAmount: string;
  retainedAmount: string;
  paidAt: string | null;
  refundDueAt?: string | null;
  refundedAt: string | null;
  refundOverdue?: boolean;
  visitAccessGranted: boolean;
}

export interface VisitReservationWindow {
  startAt: string;
  endAt: string;
}

export interface VisitReservation {
  id: string;
  reservationNumber: string;
  status: VisitReservationStatus;
  requestedWindow: VisitReservationWindow;
  alternativeWindow: (VisitReservationWindow & { expiresAt: string | null }) | null;
  confirmedWindow: VisitReservationWindow | null;
  autoConfirmed: false;
  paymentRequired?: true;
  deposit?: ReservationDeposit | null;
}

export interface PropertyMedia {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl: string | null;
  sortOrder: number;
}

export interface PropertySummary {
  id: string;
  listingNumber: string;
  title: string;
  propertyType: PropertyType;
  transactionType: PropertyTransactionType;
  price: string;
  deposit: string | null;
  monthlyRent: string | null;
  currency: string;
  displayPrice?: PropertyDisplayPrice;
  exclusiveArea: string;
  rooms: number;
  bathrooms: number;
  city: string;
  brokerageOfficeName: string;
  media: PropertyMedia[];
}

export interface ExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  provider: string;
  sourceTimestamp: string;
  fetchedAt: string;
  expiresAt: string;
  isStale: boolean;
}

export interface PropertyDisplayPrice {
  currency: string;
  price: string | null;
  deposit: string | null;
  monthlyRent: string | null;
  sourceCurrency: string;
  rate: string;
  sourceTimestamp: string;
  isStale: boolean;
  usage: 'DISPLAY_ONLY';
}

export interface ServiceStatus {
  code: string;
  state: MenuState;
  message?: string;
}

export interface AppConfig {
  country: string;
  locale: string;
  currency: string;
  supportedCurrencies?: string[];
  exchangeRateUsage?: 'DISPLAY_ONLY';
  timezone: string;
  areaUnit: 'SQUARE_METER';
  services: Record<string, MenuState>;
  menus?: Record<string, MenuState>;
  payment?: {
    provider: 'MOCK' | 'TOSS' | 'NICEPAY' | 'NHN_KCP';
    clientKey: string | null;
    siteCode?: string | null;
    reservationDepositEnabled: boolean;
  };
  version: number;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    fieldErrors?: Array<{
      field: string;
      message: string;
    }>;
  };
  meta: ApiMeta;
}

export interface AuthenticatedUser {
  id: string;
  memberNumber: string;
  email: string | null;
  displayName: string;
  status: string;
  roles: string[];
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResult {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}
