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

export enum PropertyListingType {
  BROKERAGE = 'BROKERAGE',
  OWNER_DIRECT = 'OWNER_DIRECT',
}

export interface SavedPropertySearch {
  id: string;
  name: string;
  criteria: {
    city: string | null;
    propertyType: PropertyType | null;
    transactionType: PropertyTransactionType | null;
    currency: string;
    minPrice: string | null;
    maxPrice: string | null;
    minRooms: number | null;
  };
  alertsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum OwnershipClaimType {
  REGISTERED_OWNER = 'REGISTERED_OWNER',
  AUTHORIZED_REPRESENTATIVE = 'AUTHORIZED_REPRESENTATIVE',
}

export enum OwnershipVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum LeaseSafetyGrade {
  VERY_SAFE = 'VERY_SAFE',
  SAFE = 'SAFE',
  CAUTION = 'CAUTION',
  HIGH_RISK = 'HIGH_RISK',
  CRITICAL = 'CRITICAL',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum GuaranteeEligibility {
  ELIGIBLE = 'ELIGIBLE',
  INELIGIBLE = 'INELIGIBLE',
  UNKNOWN = 'UNKNOWN',
}

export type LeaseSafetyAvailability =
  | 'NOT_ASSESSED'
  | 'INCOMPLETE'
  | 'STALE'
  | 'READY';

export interface LeaseSafetyAssessment {
  property: {
    id: string;
    listingNumber: string;
    title: string;
    transactionType: PropertyTransactionType;
    deposit: string;
    currency: string;
  };
  availability: LeaseSafetyAvailability;
  assessmentId?: string;
  version?: number;
  score: number | null;
  grade: LeaseSafetyGrade;
  ratios?: {
    jeonse: number | null;
    totalExposure: number | null;
  };
  inputs?: {
    estimatedMarketValue: string | null;
    seniorClaimAmount: string | null;
    ownerMatched: boolean | null;
    guaranteeEligibility: GuaranteeEligibility;
    registryRiskCodes: string[];
  };
  evidence?: {
    registrySource: string | null;
    registryIssuedAt: string | null;
    registryFresh: boolean;
    valuationSource: string | null;
    valuationAssessedAt: string | null;
    valuationFresh: boolean;
  };
  missingInputs?: string[];
  deductions?: Array<{
    code: string;
    points: number;
    message: string;
  }>;
  calculationVersion?: string;
  assessedAt?: string;
  needsContractRecheck?: boolean;
  disclaimer: string;
}

export enum MediaUploadStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export interface MediaUpload {
  uploadId: string;
  propertyId: string;
  propertyMediaId: string | null;
  mediaType: 'IMAGE' | 'VIDEO';
  status: MediaUploadStatus;
  attempts: number;
  errorCode: string | null;
  originalSizeBytes: string;
  outputSizeBytes: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  queuedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
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

export enum NotificationDeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

export enum NotificationChannel {
  PUSH = 'PUSH',
  SMS = 'SMS',
}

export interface NotificationEndpoint {
  id: string;
  channel: NotificationChannel;
  platform: Platform | null;
  provider: string;
  status: 'ACTIVE' | 'INVALID' | 'REVOKED';
  locale: string | null;
  lastSeenAt: string;
}

export enum ChatMessageType {
  TEXT = 'TEXT',
  SYSTEM = 'SYSTEM',
}

export enum ElectronicContractProvider {
  MODOOSIGN = 'MODOOSIGN',
  EFORM_SIGN = 'EFORM_SIGN',
  GOVERNMENT = 'GOVERNMENT',
}

export enum ElectronicContractStatus {
  DRAFT = 'DRAFT',
  SIGNING_PENDING = 'SIGNING_PENDING',
  PARTIALLY_SIGNED = 'PARTIALLY_SIGNED',
  SIGNED = 'SIGNED',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export type ElectronicContractPartyRole = 'MEMBER' | 'REGISTRANT';
export type ElectronicContractPartyStatus =
  | 'PENDING'
  | 'VIEWED'
  | 'SIGNED'
  | 'DECLINED';

export interface ElectronicContract {
  id: string;
  contractNumber: string;
  provider: ElectronicContractProvider;
  status: ElectronicContractStatus;
  reservation: {
    id: string;
    reservationNumber: string;
    status: VisitReservationStatus;
  };
  property: {
    id: string;
    listingNumber: string;
    title: string;
    listingType: PropertyListingType;
    transactionType: PropertyTransactionType;
    city: string;
  };
  myRole: ElectronicContractPartyRole;
  parties: Array<{
    role: ElectronicContractPartyRole;
    status: ElectronicContractPartyStatus;
    memberNumber: string;
    displayName: string;
    viewedAt: string | null;
    signedAt: string | null;
    declinedAt: string | null;
  }>;
  termsVersion: string;
  signingExpiresAt: string | null;
  signedAt: string | null;
  signedDocumentAvailable: boolean;
  signedDocumentHash: string | null;
  retainedUntil: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatParticipantRole = 'MEMBER' | 'REGISTRANT';

export interface PropertyChatMessage {
  id: string;
  clientMessageId: string;
  sequence: number;
  type: ChatMessageType;
  body: string;
  senderRole: ChatParticipantRole;
  readByRecipient: boolean;
  sentAt: string;
}

export interface PropertyChatRoom {
  id: string;
  property: {
    id: string;
    listingNumber: string;
    title: string;
    status: PropertyStatus;
    city: string;
    listingType: PropertyListingType;
  };
  myRole: ChatParticipantRole;
  counterpart: {
    memberNumber: string;
    displayName: string;
  };
  lastMessageSequence: number;
  lastReadSequence: number;
  unreadCount: number;
  writable: boolean;
  latestMessage: PropertyChatMessage | null;
  lastMessageAt: string;
  createdAt: string;
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

export enum VisitTravelMode {
  DRIVE = 'DRIVE',
  TRANSIT = 'TRANSIT',
  WALK = 'WALK',
}

export interface VisitRoutePlan {
  planType: 'PRE_BOOKING_ESTIMATE';
  algorithm: 'EXACT_SHORTEST_PATH';
  optimizationMetric: 'TRAVEL_TIME' | 'DISTANCE';
  travelMode: VisitTravelMode;
  origin: {
    latitude: number;
    longitude: number;
    departureAt: string;
  };
  estimateBasis: {
    distanceMethod:
      | 'PROVIDER_ROUTE_MATRIX'
      | 'HAVERSINE_WITH_ROAD_FACTOR';
    provider: 'GOOGLE_ROUTES' | 'LOCAL_ESTIMATE';
    averageSpeedKph: number | null;
    roadFactor: number | null;
    trafficAware: boolean;
    realTimeTrafficIncluded: boolean;
    fetchedAt: string | null;
    fallbackUsed: boolean;
    fallbackReason:
      | 'PROVIDER_DISABLED'
      | 'PROVIDER_UNAVAILABLE'
      | null;
  };
  stops: Array<{
    order: number;
    property: {
      id: string;
      listingNumber: string;
      title: string;
      city: string;
      addressLine1: string;
      latitude: number;
      longitude: number;
    };
    leg: {
      straightLineDistanceKm: number;
      estimatedDistanceKm: number;
      estimatedTravelMinutes: number;
      staticTravelMinutes: number | null;
      trafficDelayMinutes: number | null;
      trafficIncluded: boolean;
      source: 'MAP_PROVIDER' | 'LOCAL_ESTIMATE';
      departAt: string;
      arrivalAt: string;
    };
    suggestedVisitWindow: VisitReservationWindow;
  }>;
  summary: {
    propertyCount: number;
    totalEstimatedDistanceKm: number;
    totalEstimatedTravelMinutes: number;
    totalVisitMinutes: number;
    totalBufferMinutes: number;
    completesAt: string;
    deadlineAt: string | null;
    fitsDeadline: boolean | null;
  };
  reservationPolicy: {
    autoConfirmed: false;
    registrantApprovalRequired: true;
    approver: 'PROPERTY_REGISTRANT';
  };
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
  listing: {
    type: PropertyListingType;
    badge: 'DIRECT_OWNER' | 'LICENSED_BROKER';
    brokerageFee: 'NONE' | 'APPLICABLE';
  };
  brokerageOfficeName: string | null;
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
  notifications?: {
    pushProvider: 'LOG' | 'FCM' | 'DISABLED';
    smsProvider: 'LOG' | 'NAVER_SENS' | 'DISABLED';
    pushRegistrationEnabled: boolean;
  };
  media?: {
    uploadMode: 'ASYNC';
    statusPollingSeconds: number;
    imageLimit: number;
    publicImageLimit: number;
    videoLimit: number;
    publicVideoLimit: number;
  };
  chat?: {
    transport: 'REST_POLLING';
    textOnly: true;
    messageMaxLength: number;
    clientMessageIdRequired: true;
    propertyRegistrantOnly: true;
  };
  electronicContract?: {
    enabled: boolean;
    mode: 'MOCK' | 'GATEWAY' | 'DISABLED';
    providers: ElectronicContractProvider[];
    externalSignatureAndIdentityVerification: true;
    retentionYears: 10;
  };
  routePlanning?: {
    provider: 'GOOGLE_ROUTES' | 'DISABLED';
    trafficAwareDrive: boolean;
    localEstimateFallback: true;
    maxProperties: 5;
  };
  leaseSafety?: {
    enabled: true;
    calculationVersion: 'LEASE_SAFETY_V1';
    registryFreshDays: 7;
    valuationFreshDays: 30;
    contractRecheckRequired: true;
    informationalOnly: true;
  };
  savedPropertySearches?: {
    enabled: true;
    maxPerUser: 20;
    newListingAlerts: true;
    pushOnly: true;
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
