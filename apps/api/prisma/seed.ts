import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuidv7 } from 'uuid';
import {
  MenuState,
  Platform,
  PrismaClient,
  ServiceModuleCode,
} from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed LIFE HOME AI.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const roles = [
  ['GENERAL_USER', '일반 사용자'],
  ['PROPERTY_OWNER', '임대인·소유자'],
  ['BROKER', '공인중개사'],
  ['BROKER_MANAGER', '중개사무소 관리자'],
  ['CUSTOMER_SUPPORT', '고객지원 담당자'],
  ['CONTENT_REVIEWER', '매물·콘텐츠 검수자'],
  ['FINANCE_MANAGER', '결제·정산 담당자'],
  ['SYSTEM_ADMIN', '시스템 관리자'],
  ['SUPER_ADMIN', '최고 관리자'],
] as const;

const permissions = [
  ['PROPERTY.READ', '매물 조회'],
  ['PROPERTY.CREATE', '매물 등록'],
  ['PROPERTY.UPDATE', '매물 수정'],
  ['PROPERTY.SUBMIT', '매물 검수 요청'],
  ['PROPERTY.APPROVE', '매물 승인'],
  ['PROPERTY.REJECT', '매물 반려'],
  ['PROPERTY.REPORT', '허위 매물 신고'],
  ['PROPERTY.REPORT.REVIEW', '허위 매물 신고 검수'],
  ['BROKER.APPROVE', '중개사 승인'],
  ['BROKER.REGISTRATION.CREATE', '중개사 등록 신청'],
  ['BROKERAGE.CREATE', '중개사무소 등록 신청'],
  ['RESERVATION.CREATE', '방문 예약 요청'],
  ['RESERVATION.RESPOND', '방문 예약 대안 응답·취소'],
  ['RESERVATION.MANAGE', '예약 관리'],
  ['CONTRACT.READ', '계약 조회'],
  ['CONTRACT.MANAGE', '계약 관리'],
  ['PAYMENT.REFUND', '결제 환불'],
  ['DISPUTE.MANAGE', '분쟁 관리'],
  ['MENU.STATE_CHANGE', '메뉴 상태 변경'],
  ['ADMIN.ROLE_CHANGE', '관리자 역할 변경'],
  ['AUDIT_LOG.READ', '감사 로그 조회'],
] as const;

const modules = [
  [ServiceModuleCode.REAL_ESTATE, '부동산', MenuState.ACTIVE, 10],
  [ServiceModuleCode.LIFE_CONVENIENCE, '생활편의', MenuState.HIDDEN, 20],
  [ServiceModuleCode.ROOMMATE, '룸메이트', MenuState.HIDDEN, 30],
  [ServiceModuleCode.SENIOR, '시니어', MenuState.HIDDEN, 40],
  [ServiceModuleCode.FUNERAL, '장례', MenuState.HIDDEN, 50],
  [ServiceModuleCode.CHILDCARE, '육아', MenuState.HIDDEN, 60],
  [ServiceModuleCode.PET, '반려동물', MenuState.HIDDEN, 70],
  [ServiceModuleCode.MOVING, '이사', MenuState.HIDDEN, 80],
  [ServiceModuleCode.COMMUNITY, '커뮤니티', MenuState.HIDDEN, 90],
] as const;

async function seedRolesAndPermissions(): Promise<void> {
  for (const [code, name] of roles) {
    await prisma.role.upsert({
      where: { code },
      update: { name },
      create: {
        id: uuidv7(),
        code,
        name,
        isSystem: true,
      },
    });
  }

  for (const [code, name] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: {
        id: uuidv7(),
        code,
        name,
      },
    });
  }

  const roleAssignments: Record<string, string[]> = {
    GENERAL_USER: [
      'PROPERTY.READ',
      'PROPERTY.REPORT',
      'BROKER.REGISTRATION.CREATE',
      'BROKERAGE.CREATE',
      'RESERVATION.CREATE',
      'RESERVATION.RESPOND',
    ],
    BROKER: [
      'PROPERTY.READ',
      'PROPERTY.CREATE',
      'PROPERTY.UPDATE',
      'PROPERTY.SUBMIT',
      'RESERVATION.MANAGE',
      'CONTRACT.READ',
      'CONTRACT.MANAGE',
    ],
    BROKER_MANAGER: [
      'PROPERTY.READ',
      'PROPERTY.CREATE',
      'PROPERTY.UPDATE',
      'PROPERTY.SUBMIT',
      'RESERVATION.MANAGE',
      'CONTRACT.READ',
      'CONTRACT.MANAGE',
    ],
    CONTENT_REVIEWER: [
      'PROPERTY.READ',
      'PROPERTY.APPROVE',
      'PROPERTY.REJECT',
      'PROPERTY.REPORT.REVIEW',
      'BROKER.APPROVE',
    ],
    SYSTEM_ADMIN: [
      'PROPERTY.READ',
      'PROPERTY.CREATE',
      'PROPERTY.UPDATE',
      'PROPERTY.SUBMIT',
      'PROPERTY.APPROVE',
      'PROPERTY.REJECT',
      'PROPERTY.REPORT',
      'PROPERTY.REPORT.REVIEW',
      'BROKER.APPROVE',
      'RESERVATION.CREATE',
      'RESERVATION.RESPOND',
      'RESERVATION.MANAGE',
      'MENU.STATE_CHANGE',
      'ADMIN.ROLE_CHANGE',
      'AUDIT_LOG.READ',
    ],
  };

  for (const [roleCode, permissionCodes] of Object.entries(roleAssignments)) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
    });
    const assignedPermissions = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    for (const permission of assignedPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }

  const superAdmin = await prisma.role.findUniqueOrThrow({
    where: { code: 'SUPER_ADMIN' },
  });
  const allPermissions = await prisma.permission.findMany();

  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdmin.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: superAdmin.id,
        permissionId: permission.id,
      },
    });
  }
}

async function seedModulesAndMenus(): Promise<void> {
  for (const [code, name, defaultState, sortOrder] of modules) {
    await prisma.serviceModule.upsert({
      where: { code },
      update: { name, defaultState, sortOrder },
      create: {
        id: uuidv7(),
        code,
        name,
        defaultState,
        sortOrder,
      },
    });
  }

  const realEstate = await prisma.serviceModule.findUniqueOrThrow({
    where: { code: ServiceModuleCode.REAL_ESTATE },
  });
  const community = await prisma.serviceModule.findUniqueOrThrow({
    where: { code: ServiceModuleCode.COMMUNITY },
  });

  const menuSeeds = [
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_SEARCH',
      name: '매물 검색',
      platform: Platform.USER_WEB,
      route: '/properties/search',
      apiScope: 'PROPERTY.READ',
      defaultState: MenuState.ACTIVE,
      sortOrder: 10,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_FAVORITES',
      name: '관심 매물',
      platform: Platform.USER_WEB,
      route: '/favorites',
      apiScope: 'PROPERTY.READ',
      defaultState: MenuState.ACTIVE,
      sortOrder: 20,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_RESERVATIONS',
      name: '방문 예약',
      platform: Platform.USER_WEB,
      route: '/reservations',
      apiScope: 'RESERVATION.CREATE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 30,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'ELECTRONIC_CONTRACT',
      name: '전자계약',
      platform: Platform.USER_WEB,
      route: '/contracts',
      apiScope: 'CONTRACT.READ',
      defaultState: MenuState.ACTIVE,
      sortOrder: 40,
    },
    {
      serviceModuleId: community.id,
      code: 'COMMUNITY_HOME',
      name: '커뮤니티',
      platform: Platform.USER_WEB,
      route: '/community',
      apiScope: null,
      defaultState: MenuState.HIDDEN,
      sortOrder: 90,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'BROKER_REGISTRATION',
      name: '중개사·중개사무소 등록',
      platform: Platform.API,
      route: '/v1/brokers/registrations',
      apiScope: 'BROKER.REGISTRATION.CREATE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 50,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'BROKER_REVIEW',
      name: '중개사 등록 심사',
      platform: Platform.API,
      route: '/v1/admin/broker-registrations',
      apiScope: 'BROKER.APPROVE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 60,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_MANAGE',
      name: '매물 등록·관리',
      platform: Platform.API,
      route: '/v1/properties',
      apiScope: 'PROPERTY.CREATE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 70,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_REVIEW',
      name: '매물 검수',
      platform: Platform.API,
      route: '/v1/admin/properties',
      apiScope: 'PROPERTY.APPROVE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 80,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_REPORT',
      name: '허위 매물 신고',
      platform: Platform.API,
      route: '/v1/properties/:propertyId/reports',
      apiScope: 'PROPERTY.REPORT',
      defaultState: MenuState.ACTIVE,
      sortOrder: 90,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_REPORT_REVIEW',
      name: '허위 매물 신고 검수',
      platform: Platform.API,
      route: '/v1/admin/property-reports',
      apiScope: 'PROPERTY.REPORT.REVIEW',
      defaultState: MenuState.ACTIVE,
      sortOrder: 100,
    },
    {
      serviceModuleId: realEstate.id,
      code: 'PROPERTY_RESERVATION_MANAGE',
      name: '매물 방문 예약 관리',
      platform: Platform.API,
      route: '/v1/broker/visit-reservations',
      apiScope: 'RESERVATION.MANAGE',
      defaultState: MenuState.ACTIVE,
      sortOrder: 110,
    },
  ] as const;

  for (const menu of menuSeeds) {
    await prisma.menu.upsert({
      where: { code: menu.code },
      update: menu,
      create: {
        id: uuidv7(),
        ...menu,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedRolesAndPermissions();
  await seedModulesAndMenus();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
